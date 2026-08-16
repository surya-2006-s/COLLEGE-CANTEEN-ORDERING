require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');
const { createClient } = require('@supabase/supabase-js');
const Razorpay = require('razorpay');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// ==================== SESSION MIDDLEWARE ====================
app.use(session({
    secret: process.env.SESSION_SECRET || 'canteen-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'canteen123';

// ==================== MULTER SETUP ====================
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/') },
    filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname) }
});
const upload = multer({ storage: storage });

// ==================== SUPABASE SETUP ====================
// ==================== SUPABASE SETUP ====================
const supabase = createClient(
    process.env.SUPABASE_URL || 'https://hsweqjtfvqjvgaapvuvm.supabase.co', 
    process.env.SUPABASE_KEY || 'sb_publishable_pjkaDrk_01WAqOZvYrdr7g_WY50OZUM'
);


console.log('🔗 Supabase connected');

// ==================== RAZORPAY SETUP ====================
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});

console.log("✅ Razorpay configured with Key ID:", process.env.RAZORPAY_KEY_ID);

if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    console.warn('❌ Razorpay keys are missing from environment. Orders will fail until RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are set on the server.');
}

// ==================== EMAIL SETUP ====================
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER || 'suryasreemanth01@gmail.com',
        pass: process.env.EMAIL_PASS || 'klbi vkdj huty fuwn'
    }
});

transporter.verify((error, success) => {
    if (error) {
        console.log('❌ Email Error:', error);
    } else {
        console.log('✅ Email ready!');
    }
});

// ==================== ROUTES ====================

// 1. HOME PAGE
app.get('/', async (req, res) => {
    try {
        req.session.cart = req.session.cart || [];
        let categories = [];

        const { data, error } = await supabase
            .from('menu')
            .select('category')
            .order('category');

        if (!error && data) {
            const uniqueCategories = [...new Set(data.map(item => item.category))];
            categories = uniqueCategories.map(cat => ({ name: cat, slug: cat }));
        }

        res.render("index", {
            categories: categories,
            cart: req.session.cart,
            user: req.session.user || null,
            requireLogin: !req.session.user
        });
    } catch (error) {
        console.log("❌ Home page error:", error);
        res.send(`
            <h1>⚠️ Something went wrong</h1>
            <p>Error: ${error.message}</p>
            <p><a href="/test">Test Route</a></p>
        `);
    }
});

// 2. MENU PAGE
app.get('/menu/:category', async (req, res) => {
    const category = req.params.category;
    let items = [];

    try {
        const { data, error } = await supabase
            .from('menu')
            .select('*')
            .eq('category', category);

        if (!error && data) {
            items = data;
        }
    } catch (err) {
        console.log("❌ Error fetching menu:", err);
    }

    res.render("menu", {
        category: category,
        items: items,
        user: req.session.user,
        cart: req.session.cart || []
    });
});

// 3. ADD TO CART
app.post('/add-to-cart', (req, res) => {
    const { itemId, itemName, price, category } = req.body;
    req.session.cart = req.session.cart || [];
    
    const existingItem = req.session.cart.find(item => item.id === itemId);
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        req.session.cart.push({
            id: itemId,
            name: itemName,
            price: parseInt(price),
            category: category,
            quantity: 1
        });
    }
    res.redirect(`/menu/${category}`);
});

// 4. CART PAGE
app.get('/cart', (req, res) => {
    const error = req.query.error || null;
    res.render('cart', { cart: req.session.cart || [], error: error });
});

app.post('/update-cart', (req, res) => {
    const { itemId, action } = req.body;
    const cart = req.session.cart || [];
    const itemIndex = cart.findIndex(item => item.id === itemId);
    
    if (itemIndex !== -1) {
        if (action === 'increase') cart[itemIndex].quantity += 1;
        else if (action === 'decrease') {
            cart[itemIndex].quantity -= 1;
            if (cart[itemIndex].quantity === 0) cart.splice(itemIndex, 1);
        } else if (action === 'remove') cart.splice(itemIndex, 1);
    }
    req.session.cart = cart;
    res.redirect('/cart');
});

// 5. CLASSROOM
app.get('/classroom', (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) return res.redirect('/');
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    if (total < 10) return res.redirect('/cart?error=minOrder');
    
    const floors = ['-1', '0', '1', '2', '3', '4'];
    const rooms = [];
    for (let floor of floors) {
        for (let roomNum = 1; roomNum <= 7; roomNum++) {
            rooms.push({
                floor: floor,
                number: `${floor === '-1' ? 'B' : floor}${roomNum.toString().padStart(2, '0')}`
            });
        }
    }
    res.render('classroom', { rooms: rooms });
});

app.post('/save-classroom', (req, res) => {
    req.session.classroom = req.body.classroom;
    res.redirect('/camera');
});

// 6. CAMERA & UPLOAD
app.get('/camera', (req, res) => {
    if (!req.session.classroom) return res.redirect('/classroom');
    res.render('camera');
});

app.post('/upload-id', upload.single('idPhoto'), (req, res) => {
    if (req.file) req.session.idPhoto = req.file.filename;
    res.redirect('/payment');
});

// 7. PAYMENT PAGES
app.get('/payment', (req, res) => {
    if (!req.session.idPhoto) return res.redirect('/camera');
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('payment', { 
        upiId: 'suryasreemanth01@okicici', 
        total: total,
        user: req.session.user || null,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID
    });
});

app.get('/upi-payment', (req, res) => {
    if (!req.session.idPhoto) return res.redirect('/camera');
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('upi-payment', { 
        upiId: 'suryasreemanth01@okicici', 
        total: total, 
        classroom: req.session.classroom || 'Not specified',
        user: req.session.user || null,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID
    });
});

// ==================== RAZORPAY PAYMENT ROUTES ====================

// 1. Create Razorpay Order
app.post('/create-razorpay-order', async (req, res) => {
    console.log('📝 Creating Razorpay order...');
    // Fail fast if keys are not configured (helps on hosted platforms)
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        console.error('❌ Cannot create Razorpay order: missing API keys');
        return res.status(500).json({ error: 'Razorpay is not configured on the server. Please contact the site administrator.' });
    }
    
    if (!req.session.cart || req.session.cart.length === 0) {
        console.log('❌ Cart is empty');
        return res.status(400).json({ error: 'Cart is empty' });
    }

    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const amountInPaise = total * 100;

    console.log('💰 Total amount:', total, 'INR (', amountInPaise, 'paise)');

    const options = {
        amount: amountInPaise,
        currency: 'INR',
        receipt: `receipt_${Date.now()}`,
        payment_capture: 1
    };

    try {
        const response = await razorpay.orders.create(options);
        console.log('✅ Razorpay order created:', response.id);
        res.json({
            order_id: response.id,
            currency: response.currency,
            amount: response.amount
        });
    } catch (error) {
        console.error('❌ Razorpay Order Error:', error);
        res.status(500).json({ error: 'Failed to create order: ' + error.message });
    }
});

// 2. Verify Payment and Process Order
app.post('/verify-payment', async (req, res) => {
    console.log('🔍 Verifying payment...');
    
    const {
        razorpay_order_id,
        razorpay_payment_id,
        razorpay_signature
    } = req.body;

    console.log('📦 Order ID:', razorpay_order_id);
    console.log('💳 Payment ID:', razorpay_payment_id);
    console.log('🔑 Signature:', razorpay_signature);

    try {
        if (!process.env.RAZORPAY_KEY_SECRET) {
            console.error('❌ Cannot verify payment: missing RAZORPAY_KEY_SECRET');
            return res.status(500).json({ success: false, message: 'Server misconfiguration: razorpay secret missing' });
        }

        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        console.log('✅ Expected signature:', expectedSignature);

        if (expectedSignature === razorpay_signature) {
            req.session.paymentVerified = true;
            console.log("✅ Payment verified successfully!");

            return res.json({
                success: true,
                message: 'Payment verified successfully!'
            });
        }

        console.log("❌ Signature mismatch!");
        return res.status(400).json({
            success: false,
            message: 'Payment verification failed - Invalid signature'
        });

    } catch (error) {
        console.error("❌ Payment verification error:", error);
        return res.status(500).json({
            success: false,
            message: 'Payment verification error: ' + error.message
        });
    }
});

// ==================== PROCESS ORDER WITH EMAIL ====================

app.post('/process-payment', async (req, res) => {
    console.log('🔍 process-payment called');
    console.log('📊 paymentVerified:', req.session.paymentVerified);
    console.log('📦 Cart items:', req.session.cart);

    if (!req.session.paymentVerified) {
        console.log('❌ Payment not verified - Order BLOCKED!');
        return res.status(400).send(`
            <h1>❌ Payment Not Verified!</h1>
            <p>Please complete the payment first.</p>
            <a href="/payment">Go back to payment</a>
        `);
    }

    console.log('✅ Payment verified - Sending email...');

    try {
        const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        const classroom = req.session.classroom || 'Not specified';
        
        let orderItemsText = '';
        let orderItemsHTML = '';
        req.session.cart.forEach(item => {
            orderItemsText += `${item.name} x${item.quantity} = ₹${item.price * item.quantity}\n`;
            orderItemsHTML += `
                <tr>
                    <td style="padding: 10px; border-bottom: 1px solid #ddd;">${item.name}</td>
                    <td style="padding: 10px; text-align: center; border-bottom: 1px solid #ddd;">${item.quantity}</td>
                    <td style="padding: 10px; text-align: right; border-bottom: 1px solid #ddd;">₹${item.price * item.quantity}</td>
                </tr>
            `;
        });

        const mailOptions = {
            from: 'suryasreemanth01@gmail.com',
            to: 'suryasreemanth01@gmail.com',
            subject: '🍽️ New Canteen Order Received!',
            text: `
=====================================
      NEW CANTEEN ORDER
=====================================

📅 Date: ${new Date().toLocaleString()}
🏫 Classroom: ${classroom}
📸 ID Photo: ${req.session.idPhoto || 'Not uploaded'}
✅ Payment: VERIFIED

📋 ORDER DETAILS:
-------------------------------------
${orderItemsText}
-------------------------------------

💰 TOTAL: ₹${total}

=====================================
    Thank you!
=====================================
            `,
            html: `
            <div style="font-family: Arial; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #ddd; border-radius: 10px;">
                <div style="background: #667eea; padding: 20px; border-radius: 10px 10px 0 0; text-align: center;">
                    <h2 style="color: white; margin: 0;">🍽️ New Canteen Order!</h2>
                </div>
                <div style="padding: 20px;">
                    <p><strong>📅 Date:</strong> ${new Date().toLocaleString()}</p>
                    <p><strong>🏫 Classroom:</strong> ${classroom}</p>
                    <p><strong>📸 ID Photo:</strong> ${req.session.idPhoto || 'Not uploaded'}</p>
                    <p><strong>✅ Payment:</strong> <span style="color: green;">VERIFIED</span></p>
                    
                    <h3>📋 Order Details:</h3>
                    <table style="width: 100%; border-collapse: collapse;">
                        <thead>
                            <tr style="background: #667eea; color: white;">
                                <th style="padding: 10px; text-align: left;">Item</th>
                                <th style="padding: 10px; text-align: center;">Qty</th>
                                <th style="padding: 10px; text-align: right;">Price</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${orderItemsHTML}
                        </tbody>
                        <tfoot>
                            <tr style="font-weight: bold; background: #f0f0f0;">
                                <td colspan="2" style="padding: 10px; text-align: right;">Total:</td>
                                <td style="padding: 10px; text-align: right; color: #667eea;">₹${total}</td>
                            </tr>
                        </tfoot>
                    </table>
                    
                    <div style="text-align: center; margin-top: 20px; padding: 15px; background: #e8f5e9; border-radius: 8px;">
                        <p style="color: #2e7d32; margin: 0;">✅ Order Confirmed!</p>
                    </div>
                </div>
            </div>
            `
        };

        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Order email sent successfully!');
        console.log('📧 Email ID:', info.messageId);

        const orderData = {
            classroom: classroom,
            items: req.session.cart,
            total: total,
            status: 'pending',
            user_id: req.session.user ? req.session.user.id : null
        };

        const { data, error } = await supabase
            .from('orders')
            .insert([orderData]);

        if (error) {
            console.error('❌ Supabase save error:', error);
            throw new Error('Failed to save order');
        }
        
        console.log('✅ Order saved to Supabase!');

        req.session.destroy();
        res.redirect('/');
    } catch (error) {
        console.error('❌ Error processing order:', error);
        res.status(500).send('Error: ' + error.message);
    }
});

// ==================== SIGNUP ====================

app.post('/signup', async (req, res) => {
    const { full_name, email, password } = req.body;
    
    try {
        // Use Supabase Auth to sign up (this handles password hashing securely)
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: {
                data: { full_name: full_name } // Pass the full name into user metadata
            }
        });

        if (error) {
            console.error('Signup error:', error);
            return res.render('signup', { error: error.message });
        }

        // If you need the user in your custom 'users' table, create it AFTER auth works
        // But for now, just redirect to login
        res.redirect('/login');
        
    } catch (error) {
        console.error('Signup error:', error);
        res.render('signup', { error: 'Error creating account. Please try again.' });
    }
});


// ==================== LOGIN ====================

app.get('/login', (req, res) => { 
    res.render('login', { error: null }); 
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        // Use Supabase Auth to sign in
        const { data, error } = await supabase.auth.signInWithPassword({
            email,
            password,
        });

        if (error || !data.user) {
            console.log("Login error:", error);
            return res.render("login", { error: "Invalid email or password." });
        }

        // Fetch the user's full_name from metadata so you can use it in the header
        const full_name = data.user.user_metadata?.full_name || email;

        // Store the user in your session
        req.session.user = {
            id: data.user.id,
            email: data.user.email,
            full_name: full_name
        };
        
        console.log("✅ User logged in:", data.user.email);
        return res.redirect("/");

    } catch (err) {
        console.log("Login Error:", err);
        return res.render("login", { error: "Invalid email or password." });
    }
});
// ==================== ADMIN ROUTES ====================

app.get('/admin-login', (req, res) => { 
    res.render('admin-login'); 
});

app.post('/admin-login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else {
        res.send('Invalid credentials! <a href="/admin-login">Try again</a>');
    }
});

app.get('/admin/dashboard', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/admin-login');
    
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .order('created_at', { ascending: false });

        const totalOrders = orders ? orders.length : 0;
        const pendingOrders = orders ? orders.filter(o => o.status === 'pending').length : 0;

        res.render('admin-dashboard', {
            orders: orders || [],
            totalOrders: totalOrders,
            pendingOrders: pendingOrders,
            todayRevenue: 0,
            todayOrders: 0
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).send('Error loading dashboard');
    }
});

app.post('/admin/update-order', async (req, res) => {
    if (!req.session.isAdmin) return res.status(401).json({ error: 'Unauthorized' });
    
    try {
        const { orderId, status } = req.body;
        const { error } = await supabase
            .from('orders')
            .update({ status: status })
            .eq('id', orderId);

        if (error) throw error;
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Update failed' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin-login');
});

// ==================== TEST ROUTE ====================
app.get('/test', (req, res) => {
    res.send('✅ Server is running! This is a test page.');
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`🔑 Razorpay Key ID: ${process.env.RAZORPAY_KEY_ID}`);
});

// ==================== ADD THESE ROUTES TO YOUR SERVER.JS ====================

// Get cart (for canteen.ejs)
app.get('/get-cart', (req, res) => {
    res.json({ cart: req.session.cart || [] });
});

// Update cart (for canteen.ejs)
app.post('/update-cart-json', (req, res) => {
    req.session.cart = req.body.cart || [];
    res.json({ success: true });
});

// Canteen page (redirects to home if not logged in)
app.get('/canteen', (req, res) => {
    if (!req.session.user) {
        return res.redirect('/login');
    }
    res.render('canteen', { 
        user: req.session.user,
        cart: req.session.cart || []
    });
});