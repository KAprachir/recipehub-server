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

    app.get('/api/admin/recipes-summary', async (req, res) => {
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

    // আইডি দিয়ে নির্দিষ্ট রেসিপি খোঁজার API
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

    // ─── USER RELATED API (Moved inside run() function) ───
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
