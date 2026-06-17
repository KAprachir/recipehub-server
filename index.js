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
    console.log('Successfully connected to MongoDB! 🚀')

    // Database and Collection Defined
    const db = client.db(process.env.DB_NAME || 'recipehub')
    const usersCollection = db.collection('users')
    const recipesCollection = db.collection('recipes')
    const favoritesCollection = db.collection('favorites')
    const reportsCollection = db.collection('reports')
    const paymentsCollection = db.collection('payments')

    // ------------------------------------------------------------------------
    // এখানে আমরা আমাদের সব API Routes (GET, POST, PUT, DELETE) লিখব
    // ------------------------------------------------------------------------

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
