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

    // Toggle Favorite Status: Adds recipe to favorites if not present, otherwise removes it
    app.post('/api/recipes/:id/favorite', verifyToken, async (req, res) => {
      try {
        const recipeId = req.params.id
        const userId = req.user.id // Better-Auth user ID from the verified token session

        // Unique query representing this user's preference for this recipe
        const query = { recipeId: recipeId, userId: userId }

        const existing = await favoritesCollection.findOne(query)

        if (existing) {
          // If already favorited, remove the document
          await favoritesCollection.deleteOne(query)

          return res.json({
            action: 'removed',
            message: 'Removed from favorites'
          })
        } else {
          // If not favorited yet, add user-recipe pairing to database
          await favoritesCollection.insertOne({
            recipeId: recipeId,
            userId: userId,
            createdAt: new Date()
          })

          return res.json({ action: 'added', message: 'Added to favorites' })
        }
      } catch (error) {
        console.error('Favorite Toggle Error:', error)
        res.status(500).send({ message: 'Internal server error' })
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

    // Get Admin Dashboard Summary: Retrieve statistics for the administrator overview
    app.get('/api/admin/overview-summary', verifyToken, async (req, res) => {
      try {
        const totalUsers = await usersCollection.countDocuments()
        const totalRecipes = await recipesCollection.countDocuments()
        const premiumMembers = await usersCollection.countDocuments({ role: 'premium' })
        const totalReports = await reportsCollection.countDocuments()

        res.send({
          totalUsers,
          totalRecipes,
          premiumMembers,
          totalReports
        })
      } catch (error) {
        console.error('Error fetching admin overview summary:', error)
        res.status(500).send({ message: 'Internal server error' })
      }
    })

    // Get Admin Reports: Fetch all moderation reports submitted by users
    app.get('/api/admin/reports', verifyToken, async (req, res) => {
      try {
        const reports = await reportsCollection.find().toArray()
        res.send(reports)
      } catch (error) {
        console.error('Error fetching admin reports:', error)
        res.status(500).send({ message: 'Internal server error' })
      }
    })

    // Dismiss Report: Dismiss a specific flagged report by marking its status as Dismissed
    app.put('/api/admin/reports/:id/dismiss', verifyToken, async (req, res) => {
      try {
        const id = req.params.id
        const query = { _id: new ObjectId(id) }
        const result = await reportsCollection.updateOne(query, { $set: { status: 'Dismissed' } })
        res.send(result)
      } catch (error) {
        console.error('Error dismissing report:', error)
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

    // Get User Favorites: Retrieve all recipes favorited by the current logged-in user
    app.get('/api/user/favorites', verifyToken, async (req, res) => {
      try {
        const userId = req.user.id
        
        // 1. Fetch user-recipe pairings from favorites collection
        const favorites = await favoritesCollection
          .find({ userId: userId })
          .toArray()
          
        // 2. Validate and convert string IDs to MongoDB ObjectIds
        const recipeIds = favorites
          .filter(fav => ObjectId.isValid(fav.recipeId))
          .map(fav => new ObjectId(fav.recipeId))
          
        // 3. Retrieve actual recipe details matching the ObjectIds
        const favoriteRecipes = await recipesCollection
          .find({ _id: { $in: recipeIds } })
          .toArray()
          
        res.send(favoriteRecipes)
      } catch (error) {
        console.error('Error fetching user favorites:', error)
        res.status(500).send({ message: 'Failed to fetch user favorites' })
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

    app.get('/api/user/dashboard-summary', verifyToken, async (req, res) => {
      try {
        // ১. ইউজারের মোট রেসিপি সংখ্যা কাউন্ট করা
        const totalRecipes = await recipesCollection.countDocuments({
          userId: req.user.id
        })

        // ২. ইউজারের মোট ফেভারিট করা রেসিপি সংখ্যা কাউন্ট করা
        const totalFavourites = await favoritesCollection.countDocuments({
          userId: req.user.id
        })

        // ৩. ইউজারের সব রেসিপি মিলিয়ে মোট কত লাইক এসেছে তা হিসাব করা
        const likesResult = await recipesCollection
          .aggregate([
            { $match: { userId: req.user.id } },
            // 🎯 ফিক্স: 'LikesCount' পরিবর্তন করে "$likesCount" করা হলো
            { $group: { _id: null, totalLikes: { $sum: '$likesCount' } } }
          ])
          .toArray()

        // ৪. ফ্রন্টএন্ডে সব কমপ্লিট ডাটা রেসপন্স আকারে পাঠানো হলো
        res.json({
          totalRecipes,
          totalFavourites,
          likesReceived: likesResult[0]?.totalLikes || 0, // অ্যারে খালি হলেও ক্র্যাশ করবে না
          trendingRecipe: { name: 'Spicy Truffle Risotto', views: '1.2k' },
          recentActivity: []
        })
      } catch (error) {
        console.error('Error fetching user dashboard summary:', error)
        res.status(500).send({ message: 'Internal server error' })
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
