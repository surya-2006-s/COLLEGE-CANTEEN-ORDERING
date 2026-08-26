require('dotenv').config();
const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
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
const supabase = createClient(
    process.env.SUPABASE_URL, 
    process.env.SUPABASE_KEY
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

// ==================== ORDER WINDOW SETTINGS ====================
const settingsPath = path.join(__dirname, 'settings.json');

// Function to get current settings
function getSettings() {
    try {
        return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
        return { isOpen: true, openTime: "08:00", closeTime: "17:00" }; // Defaults
    }
}

// Function to check if ordering is currently allowed
function isOrderWindowOpen() {
    const settings = getSettings();
    if (!settings.isOpen) return false;

    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;

    // Check if current time is between openTime and closeTime
    if (currentTime >= settings.openTime && currentTime < settings.closeTime) {
        return true;
    }
    return false;
}

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
// ==================== FAST GMAIL LOGIN (Google-style) ====================
app.get('/google-login', (req, res) => {
    res.render('quick-login'); // Renders a simple page asking for just their email
});
app.post('/quick-login-submit', async (req, res) => {
    const { email } = req.body;

    // Create a quick session (No password needed)
    req.session.user = { 
        id: 'google-user', 
        email: email, 
        full_name: email.split('@')[0] 
    };

    res.redirect('/');
});

// 2. MENU PAGE (WITH TIME CHECK)
app.get('/menu/:category', async (req, res) => {
    const category = req.params.category;

    // 🚨 BLOCK ORDERS IF CLOSED
    if (!isOrderWindowOpen()) {
        const settings = getSettings();
        return res.send(`
            <h1 style="text-align:center; margin-top: 50px;">🛑 Orders are Closed!</h1>
            <p style="text-align:center; font-size: 18px;">Kitchen is preparing food. <br> Please order again between <strong>${settings.openTime}</strong> and <strong>${settings.closeTime}</strong>.</p>
            <div style="text-align: center; margin-top: 20px;">
                <a href="/" style="padding: 10px 20px; background: #ff6b6b; color: white; text-decoration: none; border-radius: 5px;">Back to Home</a>
            </div>
        `);
    }
    // 🚨 END TIME CHECK

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

// 4. CART PAGE (WITH TIME CHECK)
app.get('/cart', (req, res) => {
    const error = req.query.error || null;

    // 🚨 BLOCK CART IF CLOSED
    if (!isOrderWindowOpen()) {
        return res.redirect('/'); 
    }
    // 🚨 END TIME CHECK

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

// 5. CAMERA & UPLOAD
app.get('/camera', (req, res) => {
    // 🚨 BLOCK PAYMENT PROCESS IF CLOSED
    if (!isOrderWindowOpen()) {
        return res.redirect('/');
    }
    if (!req.session.classroom) {
        req.session.classroom = "N/A"; 
    }
    res.render('camera');
});

app.post('/upload-id', upload.single('idPhoto'), (req, res) => {
    if (req.file) req.session.idPhoto = req.file.filename;
    req.session.rollNumber = req.body.rollNumber;
    
    // Automatically get the email from the logged-in user!
    req.session.studentEmail = req.session.user.email; 

    res.redirect('/payment');
});

// 6. PAYMENT PAGES
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

// ==================== RAZORPAY PAYMENT ROUTES ====================

// 1. Create Razorpay Order
app.post('/create-razorpay-order', async (req, res) => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
        return res.status(500).json({ error: 'Razorpay keys missing' });
    }
    if (!req.session.cart || req.session.cart.length === 0) {
        return res.status(400).json({ error: 'Cart is empty' });
    }

    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const amountInPaise = total * 100;

    const options = {
        amount: amountInPaise,
        currency: 'INR',
        receipt: `receipt_${Date.now()}`,
        payment_capture: 1
    };

    try {
        const response = await razorpay.orders.create(options);
        res.json({
            order_id: response.id,
            currency: response.currency,
            amount: response.amount
        });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create order' });
    }
});

// 2. Verify Payment and Process Order
const SHEETDB_URL = process.env.SHEETDB_URL; // Make sure you added this to Render Env Vars!

app.post('/verify-payment', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    try {
        if (!process.env.RAZORPAY_KEY_SECRET) {
            return res.status(500).json({ success: false, message: 'Server misconfiguration' });
        }

        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body)
            .digest('hex');

        if (expectedSignature === razorpay_signature) {
            req.session.paymentVerified = true;
            
            const cart = req.session.cart || [];
            const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const itemsString = cart.map(item => `${item.name} x${item.quantity}`).join(', ');

            // ========================
            // SAVE TO GOOGLE SHEET
            // ========================
            try {
                const newRow = {
                    data: [{
                        Date: new Date().toLocaleString(),
                        "Roll Number": req.session.rollNumber || 'N/A',
                        "Email": req.session.studentEmail || 'N/A',
                        Classroom: req.session.classroom || 'N/A',
                        Items: itemsString,
                        Total: `₹${total}`,
                        "Payment ID": razorpay_payment_id,
                        Status: 'Pending'
                    }]
                };

                await fetch(SHEETDB_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(newRow)
                });
                console.log('✅ Order saved to Excel.');
            } catch (e) { console.log("SheetDB error:", e.message); }

            // ========================
            // SAVE TO SUPABASE DASHBOARD
            // ========================
            const istTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
            const orderData = {
                rollNumber: req.session.rollNumber || 'N/A',
                studentEmail: req.session.studentEmail || 'N/A',
                items: itemsString,
                total: total,
                created_at: istTime, // This fixes the time
                status: 'pending'
            };
            const { data, error } = await supabase.from('orders').insert([orderData]);

            // Store the inserted order's ID so we can look it up later!
            if (error) {
                console.log("Error saving to Supabase:", error.message);
            } else {
                console.log("Order saved with ID:", data[0].id);
                req.session.lastOrderId = data[0].id; // Saves the ID in session
            }

            return res.json({ success: true, message: 'Payment verified' });
        }

        return res.status(400).json({ success: false, message: 'Invalid signature' });

    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== SIGNUP ====================
app.get('/signup', (req, res) => { 
    res.render('signup', { error: null }); 
});

app.post('/signup', async (req, res) => {
    const { full_name, email, password } = req.body;
    try {
        const { data, error } = await supabase.auth.signUp({
            email,
            password,
            options: { data: { full_name: full_name } }
        });
        if (error) return res.render('signup', { error: error.message });
        res.redirect('/login');
    } catch (error) {
        res.render('signup', { error: 'Error creating account.' });
    }
});

// ==================== LOGIN ====================
app.get('/login', (req, res) => { 
    res.render('login', { error: null }); 
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) return res.render("login", { error: "Invalid email or password." });
        if (!data.user) return res.render("login", { error: "User not found." });
        
        const full_name = data.user.user_metadata?.full_name || email;
        req.session.user = { id: data.user.id, email: data.user.email, full_name: full_name };
        return res.redirect("/");
    } catch (err) {
        return res.render("login", { error: "Invalid email or password." });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ==================== ADMIN ROUTES ====================
app.get('/admin-login', (req, res) => { res.render('admin-login'); });

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
        const { data: orders, error } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
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
        res.status(500).send('Error loading dashboard');
    }
});

// ==================== ADMIN: UPDATE ORDER WINDOW ====================
app.post('/admin/update-window', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/admin-login');
    
    const { isOpen, openTime, closeTime } = req.body;
    
    const newSettings = {
        isOpen: isOpen === 'true',
        openTime: openTime || "08:00",
        closeTime: closeTime || "17:00"
    };

    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
    res.redirect('/admin/dashboard');
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin-login');
});

// ==================== TEST EXCEL ROUTE ====================
app.get('/test-excel', async (req, res) => {
    try {
        const testData = {
            data: [{
                Date: new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }),
                "Roll Number": "22BCE9999",
                "Email": "teststudent@klh.edu.in",
                "Classroom": "N/A",
                "Items": "TEST ORDER - Maaza x1",
                "Total": "₹35",
                "Payment ID": "TEST_PAY_123",
                "Status": "Success"
            }]
        };

        const response = await fetch(SHEETDB_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(testData)
        });

        if (response.ok) {
            res.send(`
                <h1 style="color: green;">✅ SUCCESS!</h1>
                <h3>Test data has been sent to your Google Sheet.</h3>
                <p>Go refresh your Google Sheet right now. You will see a row with "TEST ORDER - Maaza x1".</p>
                <br>
                <a href="/" style="padding: 10px 20px; background: #ff6b6b; color: white; text-decoration: none; border-radius: 5px;">Back to Home</a>
            `);
        } else {
            const errorText = await response.text();
            res.send(`<h1 style="color: red;">❌ FAILED</h1><p>Error: ${errorText}</p>`);
        }
    } catch (error) {
        res.send(`<h1 style="color: red;">❌ Error</h1><p>${error.message}</p>`);
    }
});
// ==================== ADMIN: MARK ORDER AS READY ====================
app.post('/admin/mark-ready', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/admin-login');
    
    const { orderId, studentEmail, studentRoll } = req.body;

    // 1. Update the database (Supabase) to "Ready"
    const { error: updateError } = await supabase.from('orders').update({ status: 'ready' }).eq('id', orderId);
    if (updateError) console.log("Update error:", updateError.message);

    // 2. Send the "Ready for Pickup" Email to the Student!
    if (studentEmail && studentEmail !== 'N/A') {
        const mailOptions = {
            from: process.env.EMAIL_USER, // Your Gmail
            to: studentEmail, // Student's email
            subject: '📢 Your Canteen Order is Ready for Pickup!',
            html: `
                <h2>🎉 Your Order is Ready!</h2>
                <p>Hi <strong>${studentRoll}</strong>,</p>
                <p>Great news! Your food has been prepared and is <strong>ready for pickup</strong> at the KLH Canteen counter.</p>
                <p>Please show your Student ID to collect your order.</p>
                <p>Thank you for choosing KLH Canteen!</p>
            `
        };
        
        // Send email in the background
        transporter.sendMail(mailOptions)
            .then(info => console.log("✅ Ready Email sent to:", studentEmail))
            .catch(err => console.log("❌ Ready Email failed:", err.message));
    } else {
        console.log("No valid student email found for this order.");
    }

    res.redirect('/admin/dashboard');
});
// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// ==================== CART JSON ROUTES ====================
app.get('/get-cart', (req, res) => {
    res.json({ cart: req.session.cart || [] });
});

app.post('/update-cart-json', (req, res) => {
    req.session.cart = req.body.cart || [];
    res.json({ success: true });
});

app.get('/canteen', (req, res) => {
    if (!req.session.user) return res.redirect('/login');
    res.render('canteen', { user: req.session.user, cart: req.session.cart || [] });
});

