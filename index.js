const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const express = require('express')
const cors = require('cors')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000

//(Middleware)
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
    // MongoDB
    await client.connect()
    console.log('Successfully connected to MongoDB! ')

    // Database and Collection Defined
    const db = client.db(process.env.DB_NAME || 'recipehub')
    const usersCollection = db.collection('users')
    const recipesCollection = db.collection('recipes')
    const favoritesCollection = db.collection('favorites')
    const reportsCollection = db.collection('reports')
    const paymentsCollection = db.collection('payments')

    // Recipes Related Api

    app.post('/api/recipes', async (req, res) => {
      const recipesData = req.body
      const result = await recipesCollection.insertOne(recipesData)
      res.send(result)
    })

    // ফিল্টারিং, সোর্টিং এবং পেজিনেশন সহ সব রেসিপি পাওয়ার ডাইনামিক API
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

        // ২. ডাইনামিক মঙ্গোডিবি কুয়েরি অবজেক্ট তৈরি করা
        let query = { status: 'active' } // শুধুমাত্র একটিভ রেসিপিগুলো দেখাবে

        // ক্যাটাগরি ফিল্টার (রিকোয়ারমেন্ট অনুযায়ী strictly $in অপারেটর ব্যবহার করা হয়েছে)
        if (category) {
          // যদি ফ্রন্টএন্ড থেকে কমা দিয়ে একাধিক ক্যাটাগরি আসে বা একটি আসে, তাকে অ্যারে বানিয়ে $in-এ পাস করা হচ্ছে
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

        // ম্যাক্সিমাম প্রিপারেশন টাইম ফিল্টার ($lte মানে Less Than or Equal)
        if (maxTime) {
          query.preparationTime = { $lte: parseInt(maxTime) }
        }

        // ৩. সোর্টিং অবজেক্ট তৈরি করা
        let sortObj = { createdAt: -1 } // ডিফল্ট: নতুন রেসিপি আগে দেখাবে
        if (sortBy === 'Popular') {
          sortObj = { likesCount: -1 } // পপুলার: বেশি লাইক পাওয়া রেসিপি আগে দেখাবে
        } else if (sortBy === 'PrepTime') {
          sortObj = { preparationTime: 1 } // কম সময়ে রান্না হওয়া রে斯িপি আগে দেখাবে
        }

        // ৪. ডাটাবেজ থেকে ফিল্টারড ডাটা এবং টোটাল কাউন্ট নিয়ে আসা
        const recipes = await recipesCollection
          .find(query)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .toArray()

        // ফিল্টার অনুযায়ী টোটাল কতগুলো রেসিপি আছে তা কাউন্ট করা (পেজিনেশনের ফুটারের জন্য)
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

    // টেস্ট রুট (সার্ভার ঠিকঠাক চলছে কিনা চেক করার জন্য)
    app.get('/', (req, res) => {
      res.send('RecipeHub Server is running smoothly...')
    })
  } finally {
    // এখানে client.close() দেওয়া যাবে না, দিলে কানেকশন বন্ধ হয়ে যাবে।
  }
}

// রান ফাংশন কল করা এবং এরর হ্যান্ডেল করা
run().catch(console.dir)

// সার্ভার স্টার্ট করা
app.listen(port, () => {
  console.log(`Server is listening on port ${port}`)
})
