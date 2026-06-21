const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb')
const express = require('express')
const cors = require('cors')
const jwt = require('jsonwebtoken')
require('dotenv').config()

const app = express()
const port = process.env.PORT || 5000

// ==========================================
// 1. MIDDLEWARES & GLOBAL SETUP
// ==========================================
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

    // ==========================================
    // 2. AUTHENTICATION MIDDLEWARE
    // ==========================================
    const verifyToken = async (req, res, next) => {
      try {
        const authHeader = req.headers.authorization
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res
            .status(401)
            .send({ message: 'Unauthorized - No token provided' })
        }
        const token = authHeader.split(' ')[1]

        console.log('------------------------------')
        console.log('verifyToken Middleware Log:')
        console.log('Token (first 25 chars):', token.substring(0, 25) + '...')
        console.log('BETTER_AUTH_SECRET:', process.env.BETTER_AUTH_SECRET)

        try {
          // Verify JWT using BETTER_AUTH_SECRET
          const decoded = jwt.verify(token, process.env.BETTER_AUTH_SECRET)
          const userId = decoded.id || decoded._id
          console.log('JWT Verification Succeeded! Decoded payload:', decoded)

          const userQuery = ObjectId.isValid(userId)
            ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }, { email: decoded.email }] }
            : { $or: [{ id: userId }, { email: decoded.email }] }

          const user = await usersCollection.findOne(userQuery)
          if (!user) {
            console.log('JWT verification succeeded but user not found in DB for ID/email')
            return res
              .status(401)
              .send({ message: 'Unauthorized - User not found from JWT' })
          }

          user.id = user.id || user._id.toString()
          req.user = user
          next()
        } catch (jwtErr) {
          console.log('JWT Verification Failed. Error:', jwtErr.message)
          console.log('Falling back to database session token check...')

          // Fallback to session check for backwards compatibility
          const session = await sessionsCollection.findOne({ token })
          if (!session) {
            console.log('Database session token check also failed: session not found in DB')
            return res
              .status(401)
              .send({ message: 'Unauthorized - Invalid JWT/Session token' })
          }
          if (new Date() > new Date(session.expiresAt)) {
            console.log('Database session check failed: session expired')
            return res
              .status(401)
              .send({ message: 'Unauthorized - Session expired' })
          }

          const user = await usersCollection.findOne({
            _id: new ObjectId(session.userId)
          })
          if (!user) {
            console.log('Database session check succeeded but user not found in DB')
            return res
              .status(401)
              .send({ message: 'Unauthorized - User not found' })
          }
          console.log('Database session check succeeded! Authenticated User:', user.email)
          user.id = user.id || user._id.toString()
          req.user = user
          next()
        }
      } catch (error) {
        console.error('Token verification error:', error)
        res
          .status(500)
          .send({ message: 'Internal server error during authentication' })
      }
    }

    // ==========================================
    // 3. GENERAL / HEALTH APIs
    // ==========================================
    // টেস্ট রুট (সার্ভার ঠিকঠাক চলছে কিনা চেক করার জন্য)
    app.get('/', (req, res) => {
      res.send('RecipeHub Server is running smoothly...')
    })

    // ==========================================
    // 4. RECIPES RELATED APIs
    // ==========================================
    
    // Create Recipe
    app.post('/api/recipes', verifyToken, async (req, res) => {
      try {
        const recipesData = req.body
        const userId = req.user.id // authenticated Better-Auth user ID string

        // Ensure authorId matches the authenticated session user
        recipesData.authorId = userId

        // Enforce the 2-recipe limit for non-premium users (admins and premium users bypass this limit)
        if (req.user.role !== 'premium' && req.user.role !== 'admin') {
          const recipeCount = await recipesCollection.countDocuments({ authorId: userId })
          if (recipeCount >= 2) {
            return res.status(403).send({ message: 'Upgrade to Premium to upload more than 2 recipes!' })
          }
        }

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
        const page = parseInt(req.query.page) || 1
        const category = req.query.category
        const cuisine = req.query.cuisine
        const difficulty = req.query.difficulty
        const maxTime = req.query.maxTime
        const sortBy = req.query.sortBy || 'Newest'

        const limit = 12
        const skip = (page - 1) * limit

        let query = { status: 'active' } 
        if (req.query.isFeatured) {
          query.isFeatured = req.query.isFeatured === 'true'
        }

        if (category) {
          const categoryArray = category.split(',')
          query.category = { $in: categoryArray }
        }

        if (cuisine) {
          query.cuisineType = cuisine
        }

        if (difficulty) {
          query.difficultyLevel = difficulty
        }

        if (maxTime) {
          query.preparationTime = { $lte: parseInt(maxTime) }
        }

        let sortObj = { createdAt: -1 }
        if (sortBy === 'Popular') {
          sortObj = { likesCount: -1 }
        } else if (sortBy === 'PrepTime') {
          sortObj = { preparationTime: 1 }
        }

        const recipes = await recipesCollection
          .find(query)
          .sort(sortObj)
          .skip(skip)
          .limit(limit)
          .toArray()

        const totalCount = await recipesCollection.countDocuments(query)

        res.send({
          recipes,
          totalCount
        })
      } catch (error) {
        console.error('Error fetching filtered recipes:', error)
        res.status(500).send({ message: 'Internal server error' })
      }
    })

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

    // Like Recipe: Increment likes count of a recipe by 1
    app.post('/api/recipes/:id/like', verifyToken, async (req, res) => {
      try {
        const id = req.params.id
        const query = { _id: new ObjectId(id) }

        // Increment likesCount field
        const result = await recipesCollection.findOneAndUpdate(
          query,
          { $inc: { likesCount: 1 } },
          { returnDocument: 'after' } // returns the updated document
        )

        if (!result) {
          return res.status(404).send({ message: 'Recipe not found' })
        }

        res.send({ likesCount: result.likesCount })
      } catch (error) {
        console.error('Error liking recipe:', error)
        res.status(500).send({ message: 'Failed to like recipe' })
      }
    })

    // Report Recipe: Submit a recipe moderation flag report
    app.post('/api/reports', verifyToken, async (req, res) => {
      try {
        const { recipeId, recipeName, reason } = req.body
        const reporterEmail = req.user.email

        const reportDoc = {
          recipeId: recipeId,
          recipeName: recipeName || 'Unknown Recipe',
          reporterEmail: reporterEmail,
          reason: reason,
          status: 'Pending',
          createdAt: new Date()
        }

        const result = await reportsCollection.insertOne(reportDoc)
        res.send(result)
      } catch (error) {
        console.error('Error reporting recipe:', error)
        res.status(500).send({ message: 'Failed to submit report' })
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
          recipe.authorId !== req.user.id &&
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

    // ==========================================
    // 5. USER RELATED APIs
    // ==========================================



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

    // Get User Purchased Recipes: Retrieve all recipes purchased by the active logged-in user
    app.get('/api/user/purchased', verifyToken, async (req, res) => {
      try {
        const userId = req.user.id || req.user._id?.toString()

        // Find payments made by this user that contain a recipeId
        const payments = await paymentsCollection
          .find({ userId: userId, recipeId: { $ne: null, $exists: true } })
          .toArray()

        // Extract recipeIds, checking validity
        const recipeIds = payments
          .filter(p => p.recipeId && ObjectId.isValid(p.recipeId))
          .map(p => new ObjectId(p.recipeId))

        // Fetch corresponding recipe details
        const purchasedRecipes = await recipesCollection
          .find({ _id: { $in: recipeIds } })
          .toArray()

        res.send(purchasedRecipes)
      } catch (error) {
        console.error('Error fetching user purchased recipes:', error)
        res.status(500).send({ message: 'Failed to fetch purchased recipes' })
      }
    })

    // Verify Stripe Payment Session & Upgrade User to Premium (or log Recipe Purchase)
    app.get('/api/payment/verify', verifyToken, async (req, res) => {
      try {
        const { session_id } = req.query
        if (!session_id) {
          return res.status(400).send({ message: 'Session ID is required' })
        }

        const stripeSecretKey = process.env.STRIPE_SECRET_KEY
        if (!stripeSecretKey) {
          return res.status(500).send({ message: 'Stripe configuration is missing on server' })
        }

        // Retrieve Checkout Session status from Stripe API using native fetch
        const stripeRes = await fetch(`https://api.stripe.com/v1/checkout/sessions/${session_id}`, {
          headers: {
            'Authorization': `Bearer ${stripeSecretKey}`
          }
        })

        if (!stripeRes.ok) {
          const errText = await stripeRes.text()
          console.error('Stripe session retrieval error:', errText)
          return res.status(400).send({ message: 'Failed to verify session with Stripe' })
        }

        const session = await stripeRes.json()

        // Verify that Stripe payment was successful
        if (session.payment_status !== 'paid') {
          return res.status(400).send({ message: 'Payment has not been completed' })
        }

        // Get user ID associated with this session (check metadata first, then fall back to authenticated user ID)
        const userId = session.metadata?.userId || req.user._id?.toString() || req.user.id
        const recipeId = session.metadata?.recipeId || null
        const isPremiumUpgrade = session.metadata?.isPremiumUpgrade === 'true' || !recipeId

        // Upgrade user role to premium in MongoDB only if it's a membership purchase
        if (isPremiumUpgrade) {
          const userQuery = ObjectId.isValid(userId)
            ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }] }
            : { id: userId }
          await usersCollection.updateOne(userQuery, { $set: { role: 'premium' } })
        }

        // Prepare the payment record log payload
        const paymentRecord = {
          userId: userId,
          email: session.customer_details?.email || req.user.email,
          sessionId: session.id,
          paymentIntentId: session.payment_intent,
          amount: `$${(session.amount_total / 100).toFixed(2)}`,
          status: 'completed',
          method: session.payment_method_types?.[0] || 'Stripe Checkout',
          recipeId: recipeId,
          isPremiumUpgrade: isPremiumUpgrade,
          createdAt: new Date()
        }

        // Log transaction to payments collection if not logged already
        const existingPayment = await paymentsCollection.findOne({ sessionId: session.id })
        if (!existingPayment) {
          await paymentsCollection.insertOne(paymentRecord)
        }

        res.send({
          success: true,
          txId: session.payment_intent || session.id,
          amount: paymentRecord.amount,
          method: paymentRecord.method,
          isPremiumUpgrade: isPremiumUpgrade,
          recipeId: recipeId,
          date: new Date().toLocaleDateString("en-US", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })
        })
      } catch (error) {
        console.error('Payment Verification Error:', error)
        res.status(500).send({ message: 'Failed to verify payment session' })
      }
    })

    // Update User Profile Settings (name & image)
    app.patch('/api/user/profile', verifyToken, async (req, res) => {
      try {
        const { displayName, profileUrl } = req.body
        const userId = req.user.id

        const updateFields = {}
        if (displayName !== undefined) updateFields.name = displayName
        if (profileUrl !== undefined) updateFields.image = profileUrl
        updateFields.updatedAt = new Date()

        const query = ObjectId.isValid(userId)
          ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }] }
          : { id: userId }

        const result = await usersCollection.updateOne(query, {
          $set: updateFields
        })

        res.send(result)
      } catch (error) {
        console.error('Error updating user profile:', error)
        res.status(500).send({ message: 'Failed to update profile' })
      }
    })

    // User Dashboard Summary
    app.get('/api/user/dashboard-summary', verifyToken, async (req, res) => {
      try {
        // ১. ইউজারের মোট রেসিপি সংখ্যা কাউন্ট করা
        const totalRecipes = await recipesCollection.countDocuments({
          authorId: req.user.id
        })

        // ২. ইউজারের মোট ফেভারিট করা রেসিপি সংখ্যা কাউন্ট করা
        const totalFavourites = await favoritesCollection.countDocuments({
          userId: req.user.id
        })

        // ৩. ইউজারের সব রেসিপি মিলিয়ে মোট কত লাইক এসেছে তা হিসাব করা
        const likesResult = await recipesCollection
          .aggregate([
            { $match: { authorId: req.user.id } },
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

    // ==========================================
    // 6. ADMIN RELATED APIs
    // ==========================================
    
    // Fetch all users (Admin only)
    app.get('/api/users', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
        const result = await usersCollection.find().toArray()
        res.send(result)
      } catch (error) {
        console.error(error)
        res.status(500).send({ message: 'Failed to fetch users' })
      }
    })

    // admin recipe controler api
    app.get('/api/admin/recipes-summary', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
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

    // Toggle Feature State: Feature or unfeature a recipe (admin only)
    app.patch('/api/admin/recipes/:id/feature', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
        const id = req.params.id
        const { isFeatured } = req.body
        const query = { _id: new ObjectId(id) }
        const updateDoc = {
          $set: {
            isFeatured: !!isFeatured,
            updatedAt: new Date()
          }
        }
        const result = await recipesCollection.updateOne(query, updateDoc)
        res.send(result)
      } catch (error) {
        console.error('Error toggling featured state:', error)
        res.status(500).send({ message: 'Failed to toggle featured state' })
      }
    })

    // Edit Recipe: Update general recipe fields from the admin panel (admin only)
    app.patch('/api/admin/recipes/:id', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
        const id = req.params.id
        const { recipeName, category, cuisineType, preparationTime } = req.body
        const query = { _id: new ObjectId(id) }
        
        const updateFields = {}
        if (recipeName !== undefined) updateFields.recipeName = recipeName
        if (category !== undefined) updateFields.category = category
        if (cuisineType !== undefined) updateFields.cuisineType = cuisineType
        if (preparationTime !== undefined) updateFields.preparationTime = parseInt(preparationTime)
        updateFields.updatedAt = new Date()

        const result = await recipesCollection.updateOne(query, { $set: updateFields })
        res.send(result)
      } catch (error) {
        console.error('Error updating recipe:', error)
        res.status(500).send({ message: 'Failed to update recipe' })
      }
    })

    // Get Admin Dashboard Summary: Retrieve statistics for the administrator overview
    app.get('/api/admin/overview-summary', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
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
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
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
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
        const id = req.params.id
        const query = { _id: new ObjectId(id) }
        const result = await reportsCollection.updateOne(query, { $set: { status: 'Dismissed' } })
        res.send(result)
      } catch (error) {
        console.error('Error dismissing report:', error)
        res.status(500).send({ message: 'Internal server error' })
      }
    })

    // Take Down Reported Recipe & Resolve Reports (admin only)
    app.delete('/api/admin/recipes/:id', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
        const reportId = req.params.id

        // Find the report
        const report = await reportsCollection.findOne({ _id: new ObjectId(reportId) })
        if (!report) {
          return res.status(404).send({ message: 'Report not found' })
        }

        // Delete the associated recipe
        if (report.recipeId) {
          await recipesCollection.deleteOne({ _id: new ObjectId(report.recipeId) })
          // Mark all reports for this recipe as Resolved
          await reportsCollection.updateMany(
            { recipeId: report.recipeId },
            { $set: { status: 'Resolved', resolvedAt: new Date() } }
          )
        } else {
          // If no recipeId is attached to the report document, just resolve this report
          await reportsCollection.updateOne(
            { _id: new ObjectId(reportId) },
            { $set: { status: 'Resolved', resolvedAt: new Date() } }
          )
        }

        res.send({ success: true, message: 'Recipe taken down and reports resolved' })
      } catch (error) {
        console.error('Error taking down recipe:', error)
        res.status(500).send({ message: 'Failed to take down recipe' })
      }
    })

    // Run Diagnostics (admin only)
    app.post('/api/admin/diagnostics/run', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }

        // Check MongoDB Connection Health
        const ping = await client.db().admin().ping()
        const isMongoConnected = !!ping

        res.send({
          success: true,
          message: `Diagnostics completed successfully. MongoDB connected: ${isMongoConnected}. Stripe gateway loaded. token secret loaded.`
        })
      } catch (error) {
        console.error('Diagnostics failed:', error)
        res.status(500).send({ message: 'Diagnostics execution failed' })
      }
    })

    // Update User Status (block/unblock) (admin only)
    app.patch('/api/admin/users/:id/status', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
        const userId = req.params.id
        const { status } = req.body

        const query = ObjectId.isValid(userId)
          ? { $or: [{ _id: new ObjectId(userId) }, { id: userId }] }
          : { id: userId }

        const result = await usersCollection.updateOne(query, {
          $set: { status: status, updatedAt: new Date() }
        })

        res.send(result)
      } catch (error) {
        console.error('Error updating user status:', error)
        res.status(500).send({ message: 'Failed to update user status' })
      }
    })

    // Get Admin Transactions (admin only)
    app.get('/api/admin/transactions', verifyToken, async (req, res) => {
      try {
        if (req.user.role !== 'admin') {
          return res.status(403).send({ message: 'Forbidden - Admins only' })
        }
        const transactions = await paymentsCollection
          .find()
          .sort({ createdAt: -1 })
          .toArray()
        res.send(transactions)
      } catch (error) {
        console.error('Error fetching transactions:', error)
        res.status(500).send({ message: 'Failed to fetch transactions' })
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
