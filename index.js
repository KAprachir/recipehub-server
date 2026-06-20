const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000

// (Middleware)
app.use(cors())
app.use(express.json())

const uri = process.env.MONGODB_URI

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true
  }
})

async function run () {
  try {
    // MongoDB Connection
    await client.connect()
    console.log('Successfully connected to MongoDB! 🎉')

    // Database and Collections Defined
    const db = client.db(process.env.DB_NAME || 'recipehub')
    const usersCollection = db.collection('user')
    const recipesCollection = db.collection('recipes')
    const favoritesCollection = db.collection('favorites')
    const reportsCollection = db.collection('reports')
    const paymentsCollection = db.collection('payments')
    const sessionsCollection = db.collection('session')

    const verifyToken = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res
            .status(401)
            .send({ message: 'Unauthorized - No token provided' })
        }
        const token = authHeader.split(' ')[1]
        // session কালেকশন থেকে টোকেন চেক করা হলো
        const session = await sessionsCollection.findOne({ token })
        if (!session) {
          return res
            .status(401)
            .send({ message: 'Unauthorized - Invalid token' })
        }
        // ইউজার কালেকশন থেকে ইউজার বের করুন
        if (new Date() > new Date(session.expiresAt)) {
          return res
            .status(401)
            .send({ message: 'Unauthorized - Session expired' })
        }

        const user = await usersCollection.findOne({
          _id: new ObjectId(session.userId)
        })
        if (!user) {
          return res
            .status(401)
            .send({ message: 'Unauthorized - User not found' })
        }
        // রিকোয়েস্ট অবজেক্টে ইউজার সেট করে দিন
        req.user = user
        next()
      } catch (error) {
        console.error('Token verification error:', error)
        res
          .status(500)
          .send({ message: 'Internal server error during authentication' })
      }
    }

    // টেস্ট রুট (সার্ভার ঠিকঠাক চলছে কিনা চেক করার জন্য)
    app.get('/', (req, res) => {
      res.send('RecipeHub Server is running smoothly...')
    })

    // ─── RECIPES RELATED API ───

    app.post('/api/recipes', async (req, res) => {
      try {
        const recipesData = req.body
        const result = await recipesCollection.insertOne(recipesData)
        res.send(result)
      } catch (error) {
        console.error(error)
        res.status(500).send({ message: 'Failed to insert recipe' })
      }
    })

    // ফিল্টারিং, সোর্টিং এবং পেজিনেশন সহ সব রেসিপি পাওয়ার ডাইনামিক API
    app.get('/api/recipes', async (req, res) => {
      try {
        // ১. ফ্রন্টএন্ড থেকে পাঠানো Query Parameters গুলো রিসিভ করা
        const page = parseInt(req.query.page) || 1
        const category = req.query.category
        const cuisine = req.query.cuisine
        const difficulty = req.query.difficulty
        const maxTime = req.query.maxTime
        const sortBy = req.query.sortBy || 'Newest'

        // পেজিনেশনের হিসাব (প্রতি পেজে ১২টি করে কার্ড দেখাবে)
        const limit = 12
        const skip = (page - 1) * limit

        // ২. ডাইনামিক মঙ্গোডিবি কুয়েরি অবজেক্ট তৈরি করা
        let query = { status: 'active' } // শুধুমাত্র একটিভ রেসিপিগুলো দেখাবে

        // ক্যাটাগরি ফিল্টার
        if (category) {
          const categoryArray = category.split(',')
          query.category = { $in: categoryArray }
        }

        // কুইজিন ফিল্টার
        if (cuisine) {
          query.cuisineType = cuisine
        }

        // ডিফিকাল্টি ফিল্টার
        if (difficulty) {
          query.difficultyLevel = difficulty
        }

        // ম্যাক্সিমাম প্রিপারেশন টাইম ফিল্টার
        if (maxTime) {
          query.preparationTime = { $lte: parseInt(maxTime) }
        }

        // ৩. সোর্টিং অবজেক্ট তৈরি করা
        let sortObj = { createdAt: -1 }
        if (sortBy === 'Popular') {
          sortObj = { likesCount: -1 }
        } else if (sortBy === 'PrepTime') {
          sortObj = { preparationTime: 1 }
        }

        // ৪. ডাটাবেজ থেকে ফিল্টারড ডাটা এবং টোটাল কাউন্ট নিয়ে আসা
        const recipes = await recipesCollection
          .find(query)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .toArray()

        const totalCount = await recipesCollection.countDocuments(query)

        // ৫. ফ্রন্টএন্ডে রেসপন্স পাঠানো
        res.send({
          recipes,
          totalCount
        })
      } catch (error) {
        console.error('Error fetching filtered recipes:', error)
        res.status(500).send({ message: 'Internal server error' })
      }
    })

    // আইডি দিয়ে নির্দিষ্ট রেসিপি খোঁজার for details recipes API
    app.get('/api/recipes/:id', async (req, res) => {
      try {
        const id = req.params.id
        const query = { _id: new ObjectId(id) }
        const result = await recipesCollection.findOne(query)
        res.send(result)
      } catch (error) {
        console.error(error)
        res.status(500).send({ message: 'Failed to fetch recipe' })
      }
    })

    // admin recipe controler api
    app.get('/api/admin/recipes-summary', verifyToken, async (req, res) => {
      try {
        // ডাটাবেজে থাকা সমস্ত রেসিপি একসাথে অ্যারে আকারে আনা হলো
        const recipes = await recipesCollection.find().toArray()

        // কার্ড মেকট্রিক্সের জন্য সিম্পল কাউন্ট
        const totalCount = await recipesCollection.countDocuments()
        const featuredCount = await recipesCollection.countDocuments({
          isFeatured: true
        })

        res.send({
          recipes,
          totalCount,
          featuredCount
        })
      } catch (error) {
        console.error(error)
        res.status(500).send({ message: 'Internal server error' })
      }
    })

    app.delete('/api/recipes/:id', async (req, res) => {
      const id = req.params.id
      const query = { _id: new ObjectId(id) }
      const recipe = await recipesCollection.findOne(query)
      if (!recipe) {
        return res.status(404).send({ message: 'Recipe not found' })
      }
      const result = await recipesCollection.deleteOne(query)
      res.send(result)
    })

    // user recipe controler api
    app.get('/api/user/my-recipe', verifyToken, async (req, res) => {
      try {
        const myRecipes = await recipesCollection
          .find({ userId: req.user.authorId })
          .toArray()

        res.send(myRecipes)
      } catch (error) {
        console.error('Error fetching my recipes:', error)
        res.status(500).send({ message: 'Internal server error' })
      }
    })

    // Get user-specific recipes created by the active logged-in user
    app.get('/api/user/my-recipes', verifyToken, async (req, res) => {
      try {
        const userId = req.user._id.toString()
        const myRecipes = await recipesCollection
          .find({ authorId: userId })
          .toArray()
        res.send(myRecipes)
      } catch (error) {
        console.error('Error fetching user recipes:', error)
        res.status(500).send({ message: 'Failed to fetch user recipes' })
      }
    })

    // Delete user-specific recipes created by the active logged-in user
    app.delete('/api/recipes/:id', verifyToken, async (req, res) => {
      try {
        const id = req.params.id
        const query = { _id: new ObjectId(id) }
        const recipe = await recipesCollection.findOne(query)
        if (!recipe) {
          return res.status(404).send({ message: 'Recipe not found' })
        }
        // Safety check: only author or admin can delete
        if (
          recipe.authorId !== req.user._id.toString() &&
          req.user.role !== 'admin'
        ) {
          return res.status(403).send({ message: 'Forbidden' })
        }
        const result = await recipesCollection.deleteOne(query)
        res.send(result)
      } catch (error) {
        console.error('Error deleting recipe:', error)
        res.status(500).send({ message: 'Failed to delete recipe' })
      }
    })

    // ─── USER RELATED API ───
    app.get('/api/users', async (req, res) => {
      try {
        const result = await usersCollection.find().toArray()
        res.send(result)
      } catch (error) {
        console.error(error)
        res.status(500).send({ message: 'Failed to fetch users' })
      }
    })
  } finally {
    // এখানে client.close() দেওয়া যাবে না।
  }
}

// রান ফাংশন কল করা এবং এরর হ্যান্ডেল করা
run().catch(console.dir)

// সার্ভার স্টার্ট করা
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`)
})
