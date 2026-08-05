const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const nodemailer = require('nodemailer');
const fs = require('fs');

// ==================== SUPABASE SETUP ====================
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = 'https://hsweqjifvqjvgaapvuvm.supabase.co';
const supabaseKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imhzd2VxanRmdnFqdmdhYXB2dXZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODU5MTkyNjEsImV4cCI6MjEwMTQ5NTI2MX0.2k_ACam0psekGnETmrgKTCCvG2lI0vwgzflYZZCtmWI';

const supabase = createClient(supabaseUrl, supabaseKey);
console.log('✅ Supabase client initialized.');

// ==================== EXPRESS SETUP ====================
const app = express();
const PORT = 3000;

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));
app.use(session({
    secret: 'canteen-secret-key',
    resave: false,
    saveUninitialized: true
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ==================== ADMIN CREDENTIALS ====================
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'canteen123';

// ==================== MULTER SETUP (For ID Uploads) ====================
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/uploads/')
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + '-' + file.originalname)
    }
});
const upload = multer({ storage: storage });

// ==================== USER ROUTES ====================

// Home page - Get categories from Supabase
app.get('/', async (req, res) => {
    req.session.cart = req.session.cart || [];
    
    const { data: menuItems, error } = await supabase
        .from('menu')
        .select('category');

    if (error) {
        console.log("Error fetching categories:", error.message);
        return res.render('index', { categories: [], cart: req.session.cart });
    }

    const categories = [...new Set(menuItems.map(item => item.category))];
    res.render('index', { categories: categories, cart: req.session.cart });
});

// Menu page - Get items by category from Supabase
app.get('/menu/:category', async (req, res) => {
    const category = req.params.category;
    
    const { data: items, error } = await supabase
        .from('menu')
        .select('*')
        .eq('category', category);

    if (error) {
        console.log("Error fetching menu items:", error.message);
        return res.render('menu', { category: category.replace('-', ' ').toUpperCase(), items: [], cart: req.session.cart || [] });
    }

    res.render('menu', { 
        category: category.replace('-', ' ').toUpperCase(),
        items: items,
        cart: req.session.cart || []
    });
});

// Add to cart (This uses the session, doesn't need Supabase)
app.post('/add-to-cart', (req, res) => {
    const { itemId, itemName, price, category } = req.body;
    req.session.cart = req.session.cart || [];
    
    const existingItem = req.session.cart.find(item => item.id === parseInt(itemId));
    
    if (existingItem) {
        existingItem.quantity += 1;
    } else {
        req.session.cart.push({
            id: parseInt(itemId),
            name: itemName,
            price: parseInt(price),
            category: category,
            quantity: 1
        });
    }
    
    res.redirect(`/menu/${category}`);
});

// Cart page
app.get('/cart', (req, res) => {
    const error = req.query.error || null;
    res.render('cart', { cart: req.session.cart || [], error: error });
});

// Update cart
app.post('/update-cart', (req, res) => {
    const { itemId, action } = req.body;
    const cart = req.session.cart || [];
    const itemIndex = cart.findIndex(item => item.id === parseInt(itemId));
    
    if (itemIndex !== -1) {
        if (action === 'increase') {
            cart[itemIndex].quantity += 1;
        } else if (action === 'decrease') {
            cart[itemIndex].quantity -= 1;
            if (cart[itemIndex].quantity === 0) {
                cart.splice(itemIndex, 1);
            }
        } else if (action === 'remove') {
            cart.splice(itemIndex, 1);
        }
    }
    
    req.session.cart = cart;
    res.redirect('/cart');
});

// Classroom selection
app.get('/classroom', (req, res) => {
    if (!req.session.cart || req.session.cart.length === 0) {
        return res.redirect('/');
    }
    
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    const minOrder = 100;
    if (total < minOrder) {
        return res.redirect('/cart?error=minOrder');
    }
    
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

// Save classroom
app.post('/save-classroom', (req, res) => {
    req.session.classroom = req.body.classroom;
    res.redirect('/camera');
});

// Camera page
app.get('/camera', (req, res) => {
    if (!req.session.classroom) {
        return res.redirect('/classroom');
    }
    res.render('camera');
});

// Upload ID
app.post('/upload-id', upload.single('idPhoto'), (req, res) => {
    if (req.file) {
        req.session.idPhoto = req.file.filename;
    }
    res.redirect('/payment');
});

// Payment page
app.get('/payment', (req, res) => {
    if (!req.session.idPhoto) {
        return res.redirect('/camera');
    }
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('payment', { upiId: 'suryasreemanth01@okicici', total: total });
});

// UPI Payment page
app.get('/upi-payment', (req, res) => {
    if (!req.session.idPhoto) {
        return res.redirect('/camera');
    }
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('upi-payment', { upiId: 'suryasreemanth01@okicici', total: total, classroom: req.session.classroom || 'Not specified' });
});

// QR Payment page
app.get('/qr-payment', (req, res) => {
    if (!req.session.idPhoto) {
        return res.redirect('/camera');
    }
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('qr-payment', { upiId: 'suryasreemanth01@okicici', total: total, classroom: req.session.classroom || 'Not specified' });
});
// ==================== AUTH ROUTES (USERS) ====================

// Render Sign Up page
app.get('/signup', (req, res) => {
    res.render('signup', { error: null });
});

// Handle Sign Up (Save to Supabase 'users' table)
app.post('/signup', async (req, res) => {
    const { full_name, email, password } = req.body;

    // 1. Check if user already exists in the 'users' table
    const { data: existingUser, error: checkError } = await supabase
        .from('users')
        .select('email')
        .eq('email', email);

    if (checkError) {
        console.log("Check user error:", checkError.message);
        return res.render('signup', { error: "Database error. Please try again." });
    }

    if (existingUser && existingUser.length > 0) {
        return res.render('signup', { error: "An account with this email already exists." });
    }

    // 2. Insert the new user into Supabase
    const { error: insertError } = await supabase
        .from('users')
        .insert([{ full_name: full_name, email: email, password: password }]);

    if (insertError) {
        console.log("Signup Error:", insertError.message);
        return res.render('signup', { error: "Error creating account. Please try again." });
    }

    // 3. Success! Redirect to login
    res.redirect('/login');
});

// Render Login page
app.get('/login', (req, res) => {
    res.render('login', { error: null });
});

// Handle Login (Check Supabase 'users' table)
app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    // 1. Check if user exists in Supabase
    const { data: user, error } = await supabase
        .from('users')
        .select('*')
        .eq('email', email)
        .single(); // Expect exactly one user

    if (error || !user) {
        return res.render('login', { error: "Invalid email or password." });
    }

    // 2. Check if password matches
    if (user.password !== password) {
        return res.render('login', { error: "Invalid email or password." });
    }

    // 3. Save user info in session (Logged in!)
    req.session.user = user;
    console.log(`✅ User ${user.full_name} logged in!`);
    res.redirect('/');
});

// Logout Route
app.get('/logout', (req, res) => {
    req.session.user = null;
    res.redirect('/login');
});
// ==================== PAYMENT VERIFICATION ====================

app.get('/check-payment-status', (req, res) => {
    res.json({ 
        paymentVerified: req.session.paymentVerified || false,
        message: req.session.paymentVerified ? 'Payment verified!' : 'Waiting for payment...'
    });
});

// Simulate payment
app.post('/simulate-payment', async (req, res) => {
    req.session.paymentVerified = true;
    console.log('💰 SIMULATED PAYMENT DETECTED');
    await sendOrderEmail(req.session);
    req.session.destroy();
    res.redirect('/');
});

// ==================== FINALIZE ORDER (SAVE TO SUPABASE) ====================

app.post('/process-payment', async (req, res) => {
    if (!req.session.paymentVerified) {
        console.log('❌ Payment not verified - Order BLOCKED!');
        return res.status(400).send(`
            <h1>❌ Payment Not Verified!</h1>
            <p>Please complete the payment first.</p>
            <a href="/payment">Go back to payment</a>
        `);
    }
    
    try {
        const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        
        // Save to Supabase 'orders' table
        const { error } = await supabase
            .from('orders')
            .insert([{
                classroom: req.session.classroom || 'Not specified',
                items: req.session.cart,
                total: total,
                upi_id: 'suryasreemanth01@okicici',
                id_photo: req.session.idPhoto || '',
                status: 'pending',
                user_email: 'guest@college.com' // Placeholder email for now
            }]);

        if (error) {
            console.error('❌ Supabase insert error:', error.message);
            return res.status(500).send('Error saving order to database');
        }

        console.log('✅ Order saved to Supabase!');
        await sendOrderEmail(req.session);
        
        req.session.destroy();
        res.redirect('/');
    } catch (error) {
        console.error('❌ Error processing order:', error);
        res.status(500).send('Error processing order');
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
    if (!req.session.isAdmin) {
        return res.redirect('/admin-login');
    }
    
    try {
        const { data: orders, error } = await supabase
            .from('orders')
            .select('*')
            .order('id', { ascending: false });

        if (error) {
            console.error("Error fetching orders:", error.message);
            return res.status(500).send('Error loading dashboard');
        }

        const totalOrders = orders.length;
        const pendingOrders = orders.filter(o => o.status === 'pending').length;
        
        const today = new Date().toISOString().split('T')[0];
        const todayOrders = orders.filter(o => o.created_at && o.created_at.startsWith(today));
        const todayRevenue = todayOrders.reduce((sum, order) => sum + order.total, 0);

        res.render('admin-dashboard', {
            orders: orders,
            totalOrders: totalOrders,
            pendingOrders: pendingOrders,
            todayRevenue: todayRevenue,
            todayOrders: todayOrders.length
        });
    } catch (error) {
        console.error('Error loading dashboard:', error);
        res.status(500).send('Error loading dashboard');
    }
});

app.post('/admin/update-order', async (req, res) => {
    if (!req.session.isAdmin) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    
    try {
        const { orderId, status } = req.body;

        const { error } = await supabase
            .from('orders')
            .update({ status: status })
            .eq('id', orderId);

        if (error) {
            console.error('Error updating order:', error.message);
            return res.status(500).json({ error: 'Update failed' });
        }

        res.json({ success: true });
    } catch (error) {
        console.error('Error updating order:', error);
        res.status(500).json({ error: 'Update failed' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin-login');
});

// ==================== EMAIL FUNCTION ====================

async function sendOrderEmail(session) {
    const transporter = nodemailer.createTransport({
        service: 'gmail',
        auth: {
            user: 'suryasreemanth01@gmail.com',
            pass: 'rfaw wexf avax ozld'
        }
    });

    const orderItems = session.cart.map(item => 
        `${item.name} x${item.quantity} = ₹${item.price * item.quantity}`
    ).join('\n');

    const total = session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    const mailOptions = {
        from: 'suryasreemanth01@gmail.com',
        to: 'suryasreemanth01@gmail.com',
        subject: '🍽️ New Canteen Order Received!',
        text: `
=====================================
      NEW CANTEEN ORDER
=====================================

📅 Date & Time: ${new Date().toLocaleString()}
🏫 Classroom: ${session.classroom || 'Not specified'}
📸 ID Photo: ${session.idPhoto || 'Not uploaded'}
✅ Payment Status: VERIFIED

📋 ORDER DETAILS:
-------------------------------------
${orderItems}
-------------------------------------

💰 TOTAL AMOUNT: ₹${total}

=====================================
    Thank you for using Canteen App!
=====================================
        `
    };

    try {
        await transporter.sendMail(mailOptions);
        console.log('✅ Order email sent successfully!');
    } catch (error) {
        console.error('❌ Error sending email:', error);
    }
}

// ==================== CLEANUP OLD UPLOADS ====================

setInterval(() => {
    const uploadDir = path.join(__dirname, 'public/uploads');
    if (!fs.existsSync(uploadDir)) return;

    try {
        const files = fs.readdirSync(uploadDir);
        const now = Date.now();
        const oneDay = 24 * 60 * 60 * 1000;

        files.forEach(file => {
            const filePath = path.join(uploadDir, file);
            const stats = fs.statSync(filePath);
            const fileAge = now - stats.mtimeMs;

            if (fileAge > oneDay) {
                fs.unlinkSync(filePath);
                console.log(`🗑️ Deleted old file: ${file}`);
            }
        });
    } catch (error) {
        console.error('Error cleaning uploads:', error);
    }
}, 60 * 60 * 1000);

// ==================== START SERVER ====================

app.listen(PORT, () => {
    console.log(`🚀 Server is running on http://localhost:${PORT}`);
    console.log(`🛍️  Customer URL: http://localhost:${PORT}`);
    console.log(`🔐 Admin URL: http://localhost:${PORT}/admin-login`);
    console.log(`   Username: admin`);
    console.log(`   Password: canteen123`);
});