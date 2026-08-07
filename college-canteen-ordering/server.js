const express = require('express');
const session = require('express-session');
const bodyParser = require('body-parser');
const path = require('path');
const multer = require('multer');
const fs = require('fs');
const nodemailer = require('nodemailer');

const app = express();
const PORT = 3000;

// ==================== MIDDLEWARE ====================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

// ==================== SESSION MIDDLEWARE ====================
app.use(session({
    secret: 'canteen-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 24 * 60 * 60 * 1000
    }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'canteen123';

// ==================== MULTER SETUP ====================
const storage = multer.diskStorage({
    destination: function (req, file, cb) { cb(null, 'public/uploads/') },
    filename: function (req, file, cb) { cb(null, Date.now() + '-' + file.originalname) }
});
const upload = multer({ storage: storage });

// ==================== POCKETBASE SETUP ====================
const PB_URL = 'http://127.0.0.1:8090';

// ==================== EMAIL SETUP ====================
// UPDATE THIS WITH YOUR NEW APP PASSWORD
const EMAIL_PASSWORD = 'klbi vkdj huty fuwn'; // <-- CHANGE THIS!

const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
        user: 'suryasreemanth01@gmail.com',
        pass: EMAIL_PASSWORD
    }
});

// Test email connection
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
    req.session.cart = req.session.cart || [];
    let categories = [];

    try {
        const response = await fetch(`${PB_URL}/api/collections/menu/records`);
        if (response.ok) {
            const data = await response.json();
            const uniqueCategories = [...new Set(data.items.map(item => item.category))];
            categories = uniqueCategories.map(cat => ({
                name: cat,
                slug: cat
            }));
        }
    } catch (error) {
        console.log("⚠️ Menu fetch failed.");
    }

    res.render("index", {
        categories: categories,
        cart: req.session.cart,
        user: req.session.user || null,
        requireLogin: !req.session.user
    });
});

// 2. MENU PAGE
app.get('/menu/:category', async (req, res) => {
    const category = req.params.category;
    let items = [];

    try {
        const response = await fetch(
            `${PB_URL}/api/collections/menu/records?filter=(category="${category}")`
        );
        if (response.ok) {
            const data = await response.json();
            items = data.items || [];
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
    if (total < 100) return res.redirect('/cart?error=minOrder');
    
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
    res.render('payment', { upiId: 'suryasreemanth01@okicici', total: total });
});

app.get('/upi-payment', (req, res) => {
    if (!req.session.idPhoto) return res.redirect('/camera');
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('upi-payment', { upiId: 'suryasreemanth01@okicici', total: total, classroom: req.session.classroom || 'Not specified' });
});

app.get('/qr-payment', (req, res) => {
    if (!req.session.idPhoto) return res.redirect('/camera');
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('qr-payment', { 
        upiId: 'qrscan@pay', 
        total: total, 
        classroom: req.session.classroom || 'Not specified' 
    });
});

// ==================== PAYMENT VERIFICATION ====================

app.get('/check-payment-status', (req, res) => {
    res.json({ 
        paymentVerified: req.session.paymentVerified || false,
        message: req.session.paymentVerified ? 'Payment verified!' : 'Waiting for payment...'
    });
});

app.post('/simulate-payment', async (req, res) => {
    req.session.paymentVerified = true;
    res.json({ success: true, paymentVerified: true });
});

// ==================== PROCESS ORDER WITH EMAIL ====================

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
        
        // Format order items
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

        // ========== SEND EMAIL ==========
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

        // Send email
        const info = await transporter.sendMail(mailOptions);
        console.log('✅ Order email sent successfully!');
        console.log('📧 Email ID:', info.messageId);
        console.log('📧 Sent to:', info.accepted);

        // Save to PocketBase
        const orderData = {
            classroom: classroom,
            items: req.session.cart,
            total: total,
            status: 'pending',
            user_email: req.session.user ? req.session.user.email : 'guest@college.com'
        };
        
        const formData = new FormData();
        for (const key in orderData) {
            formData.append(key, JSON.stringify(orderData[key]));
        }

        const response = await fetch(`${PB_URL}/api/collections/orders/records`, {
            method: 'POST',
            body: formData
        });

        if (!response.ok) throw new Error('Failed to save order');
        
        console.log('✅ Order saved to PocketBase!');

        req.session.destroy();
        res.redirect('/');
    } catch (error) {
        console.error('❌ Error processing order:', error);
        res.status(500).send('Error: ' + error.message);
    }
});


// ==================== SIGNUP & LOGIN ====================

app.get('/signup', (req, res) => { 
    res.render('signup', { error: null }); 
});

app.post('/signup', async (req, res) => {
    const { full_name, email, password } = req.body;
    try {
        const checkRes = await fetch(`${PB_URL}/api/collections/users/records?filter=email='${email}'`);
        const checkData = await checkRes.json();
        if (checkData.items && checkData.items.length > 0) {
            return res.render('signup', { error: "An account with this email already exists." });
        }

        const createRes = await fetch(`${PB_URL}/api/collections/users/records`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                full_name: full_name,
                email: email,
                password: password,
                passwordConfirm: password
            })
        });

        if (!createRes.ok) {
            const errorData = await createRes.text();
            console.log("PocketBase Error:", errorData);
            throw new Error("Signup failed");
        }
        
        res.redirect('/login');
    } catch (error) {
        console.log("Signup Error:", error.message);
        res.render('signup', { error: "Error creating account. Please try again." });
    }
});

app.get('/login', (req, res) => { 
    res.render('login', { error: null }); 
});

app.post('/login', async (req, res) => {
    const { email, password } = req.body;

    try {
        const response = await fetch(`${PB_URL}/api/collections/users/auth-with-password`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                identity: email,
                password: password
            })
        });

        const text = await response.text();

        if (!response.ok) {
            return res.render("login", {
                error: "Invalid email or password."
            });
        }

        const data = JSON.parse(text);
        req.session.user = data.record;
        console.log("✅ User logged in:", data.record.email);

        return res.redirect("/");

    } catch (err) {
        console.log("Login Error:", err);
        return res.render("login", {
            error: "Invalid email or password."
        });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.redirect('/login');
    });
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
        const response = await fetch(`${PB_URL}/api/collections/orders/records?sort=-created`);
        const data = await response.json();
        const orders = data.items || [];

        const totalOrders = orders.length;
        const pendingOrders = orders.filter(o => o.status === 'pending').length;
        const todayRevenue = orders
            .filter(o => o.created && new Date(o.created).toDateString() === new Date().toDateString())
            .reduce((sum, o) => sum + o.total, 0);

        res.render('admin-dashboard', {
            orders: orders,
            totalOrders: totalOrders,
            pendingOrders: pendingOrders,
            todayRevenue: todayRevenue,
            todayOrders: orders.filter(o => new Date(o.created).toDateString() === new Date().toDateString()).length
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
        const response = await fetch(`${PB_URL}/api/collections/orders/records/${orderId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status: status })
        });
        if (!response.ok) throw new Error('Update failed');
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: 'Update failed' });
    }
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin-login');
});

// ==================== START SERVER ====================
app.listen(PORT, () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
    console.log(`📧 Test email: http://localhost:${PORT}/test-email`);
});
app.post('/simulate-payment', async (req, res) => {
    console.log('💰 SIMULATED PAYMENT');
    req.session.paymentVerified = true;
    res.json({ success: true, paymentVerified: true });
});