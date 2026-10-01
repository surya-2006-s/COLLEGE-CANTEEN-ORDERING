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

// ==================== PAYMENT MODE ====================
// Set to "TEST" for test payment, or "RAZORPAY" for live Razorpay
const PAYMENT_MODE = process.env.PAYMENT_MODE || "TEST";
console.log(`💳 Payment Mode: ${PAYMENT_MODE}`);

// ==================== MIDDLEWARE ====================
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static('public'));

app.use(session({
    secret: process.env.SESSION_SECRET || 'canteen-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 24 * 60 * 60 * 1000 }
}));

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'canteen123';

// ==================== MULTER ====================
const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, 'public/uploads/'),
    filename: (req, file, cb) => cb(null, Date.now() + '-' + file.originalname)
});
const upload = multer({ storage });

// ==================== SUPABASE ====================
const supabase = createClient(
    process.env.SUPABASE_URL.trim(),
    process.env.SUPABASE_KEY.trim()
);
console.log('🔗 Supabase connected');

// ==================== RAZORPAY (kept intact) ====================
const razorpay = new Razorpay({
    key_id: process.env.RAZORPAY_KEY_ID,
    key_secret: process.env.RAZORPAY_KEY_SECRET
});
console.log("✅ Razorpay configured with Key ID:", process.env.RAZORPAY_KEY_ID);

// ==================== EMAIL ====================
const transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER || 'suryasreemanth01@gmail.com',
        pass: process.env.EMAIL_PASS || 'klbi vkdj huty fuwn'
    }
});

// ==================== ORDER WINDOW ====================
const settingsPath = path.join(__dirname, 'settings.json');
function getSettings() {
    try { return JSON.parse(fs.readFileSync(settingsPath, 'utf8')); }
    catch (e) { return { isOpen: true, openTime: "08:00", closeTime: "17:00" }; }
}
function isOrderWindowOpen() {
    const settings = getSettings();
    if (!settings.isOpen) return false;
    const now = new Date();
    const currentTime = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
    return currentTime >= settings.openTime && currentTime < settings.closeTime;
}

// ==================== HOME PAGE ====================
app.get('/', async (req, res) => {
    try {
        req.session.cart = req.session.cart || [];
        let categories = [];
        let activeOrder = null;

        const { data: menuData } = await supabase.from('menu').select('category').order('category');
        if (menuData) {
            const unique = [...new Set(menuData.map(item => item.category))];
            categories = unique.map(cat => ({ name: cat, slug: cat }));
        }

        if (req.session.user) {
            const { data: orderData } = await supabase
                .from('orders')
                .select('*')
                .eq('studentEmail', req.session.user.email)
                .order('created_at', { ascending: false })
                .limit(1)
                .single();
            if (orderData) activeOrder = orderData;
        }

        res.render("index", {
            categories, cart: req.session.cart,
            user: req.session.user || null,
            activeOrder, requireLogin: !req.session.user
        });
    } catch (error) {
        console.log("❌ Home page error:", error);
        res.send(`<h1>⚠️ Something went wrong</h1><p>Error: ${error.message}</p>`);
    }
});

// ==================== MENU PAGE ====================
app.get('/menu/:category', async (req, res) => {
    const category = req.params.category;
    if (!isOrderWindowOpen()) {
        const s = getSettings();
        return res.send(`<h1 style="text-align:center; margin-top: 50px;">🛑 Orders are Closed!</h1>
            <p style="text-align:center;">Please order again between <strong>${s.openTime}</strong> and <strong>${s.closeTime}</strong>.</p>
            <div style="text-align: center;"><a href="/">Back to Home</a></div>`);
    }
    let items = [];
    try {
        const { data } = await supabase.from('menu').select('*').eq('category', category);
        if (data) items = data;
    } catch (err) { console.log("❌ Menu error:", err); }

    res.render("menu", { category, items, user: req.session.user, cart: req.session.cart || [] });
});

// ==================== ADD TO CART ====================
app.post('/add-to-cart', (req, res) => {
    const { itemId, itemName, price, category } = req.body;
    req.session.cart = req.session.cart || [];
    const existing = req.session.cart.find(i => i.id === itemId);
    if (existing) existing.quantity += 1;
    else req.session.cart.push({ id: itemId, name: itemName, price: parseInt(price), category, quantity: 1 });
    res.redirect(`/menu/${category}`);
});

// ==================== CART ====================
app.get('/cart', (req, res) => {
    if (!isOrderWindowOpen()) return res.redirect('/');
    res.render('cart', { cart: req.session.cart || [], error: req.query.error || null });
});

app.post('/update-cart', (req, res) => {
    const { itemId, action } = req.body;
    const cart = req.session.cart || [];
    const idx = cart.findIndex(i => i.id === itemId);
    if (idx !== -1) {
        if (action === 'increase') cart[idx].quantity += 1;
        else if (action === 'decrease') {
            cart[idx].quantity -= 1;
            if (cart[idx].quantity === 0) cart.splice(idx, 1);
        } else if (action === 'remove') cart.splice(idx, 1);
    }
    req.session.cart = cart;
    res.redirect('/cart');
});

// ==================== CAMERA / CUSTOMER DETAILS ====================
app.get('/camera', (req, res) => {
    if (!isOrderWindowOpen()) return res.redirect('/');
    if (!req.session.classroom) req.session.classroom = "N/A";
    res.render('camera');
});

app.post('/upload-id', upload.single('idPhoto'), (req, res) => {
    if (req.file) req.session.idPhoto = req.file.filename;
    req.session.rollNumber = req.body.rollNumber;
    req.session.studentEmail = req.body.studentEmail || 'N/A';
    req.session.customerName = req.body.customerName || 'N/A';
    res.redirect('/payment');
});

// ==================== PAYMENT PAGE ====================
app.get('/payment', (req, res) => {
    if (!req.session.idPhoto) return res.redirect('/camera');
    req.session.paymentVerified = false;
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('payment', {
        upiId: 'suryasreemanth01@okicici',
        total,
        user: req.session.user || null,
        RAZORPAY_KEY_ID: process.env.RAZORPAY_KEY_ID,
        PAYMENT_MODE: PAYMENT_MODE  // <-- Pass mode to view
    });
});

// ==================== TEST PAYMENT PAGE ====================
app.get('/test-payment', (req, res) => {
    if (!req.session.idPhoto) return res.redirect('/camera');
    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    res.render('test-payment', {
        total,
        cart: req.session.cart || [],
        customerName: req.session.customerName || 'N/A',
        rollNumber: req.session.rollNumber || 'N/A',
        studentEmail: req.session.studentEmail || 'N/A'
    });
});

// ==================== TEST PAYMENT CONFIRM ====================
// Prevent duplicate clicks using a session flag
app.post('/confirm-test-payment', async (req, res) => {
    // Prevent duplicate orders
    if (req.session.testPaymentDone) {
        return res.redirect('/');
    }
    req.session.testPaymentDone = true;

    try {
        const cart = req.session.cart || [];
        if (cart.length === 0) return res.redirect('/');

        const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
        const itemsString = cart.map(i => `${i.name} x${i.quantity}`).join(', ');
        const testPaymentId = 'TEST_' + Math.random().toString(36).substring(2, 10).toUpperCase();
        const orderId = 'ORD-' + Date.now().toString().slice(-6);
        const istTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });

        // Save to Google Sheet (existing)
        try {
            await fetch(process.env.SHEETDB_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ data: [{
                    Date: istTime,
                    "Roll Number": req.session.rollNumber || 'N/A',
                    "Email": req.session.studentEmail || 'N/A',
                    Classroom: req.session.classroom || 'N/A',
                    Items: itemsString,
                    Total: `₹${total}`,
                    "Payment ID": testPaymentId,
                    Status: 'TEST PAID'
                }]})
            });
        } catch (e) { console.log("SheetDB error:", e.message); }

        // Save to Supabase
        const orderData = {
            orderId: orderId,
            customerName: req.session.customerName || 'N/A',
            rollNumber: req.session.rollNumber || 'N/A',
            studentEmail: req.session.studentEmail || 'N/A',
            items: itemsString,
            total: total,
            paymentStatus: 'TEST_PAID',
            paymentId: testPaymentId,
            status: 'ORDER_RECEIVED',
            created_at: istTime,
            updatedAt: istTime
        };

        const { data, error } = await supabase.from('orders').insert([orderData]);
        if (error) console.log("Supabase error:", error.message);
        else console.log("✅ Test order saved:", orderId);

        // Clear cart and temp session data
        req.session.cart = [];
        req.session.idPhoto = null;
        req.session.rollNumber = null;
        req.session.studentEmail = null;
        req.session.customerName = null;

        res.redirect('/?testpaid=1');
    } catch (error) {
        console.log("❌ Confirm test payment error:", error.message);
        res.redirect('/');
    }
});

// ==================== EXISTING RAZORPAY ROUTES (KEPT INTACT) ====================
app.post('/create-razorpay-order', async (req, res) => {
    if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET)
        return res.status(500).json({ error: 'Razorpay keys missing' });
    if (!req.session.cart || req.session.cart.length === 0)
        return res.status(400).json({ error: 'Cart is empty' });

    const total = req.session.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);

    try {
        const response = await razorpay.orders.create({
            amount: total * 100,
            currency: 'INR',
            receipt: `receipt_${Date.now()}`,
            payment_capture: 1
        });
        res.json({ order_id: response.id, currency: response.currency, amount: response.amount });
    } catch (error) {
        res.status(500).json({ error: 'Failed to create order' });
    }
});

const SHEETDB_URL = process.env.SHEETDB_URL;

app.post('/verify-payment', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
    try {
        if (!process.env.RAZORPAY_KEY_SECRET)
            return res.status(500).json({ success: false, message: 'Server misconfiguration' });

        const body = razorpay_order_id + '|' + razorpay_payment_id;
        const expectedSignature = crypto.createHmac('sha256', process.env.RAZORPAY_KEY_SECRET)
            .update(body).digest('hex');

        if (expectedSignature === razorpay_signature) {
            req.session.paymentVerified = true;
            const cart = req.session.cart || [];
            const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            const itemsString = cart.map(item => `${item.name} x${item.quantity}`).join(', ');
            const istTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
            const orderId = 'ORD-' + Date.now().toString().slice(-6);

            // Google Sheet
            try {
                await fetch(SHEETDB_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ data: [{
                        Date: istTime,
                        "Roll Number": req.session.rollNumber || 'N/A',
                        "Email": req.session.studentEmail || 'N/A',
                        Classroom: req.session.classroom || 'N/A',
                        Items: itemsString,
                        Total: `₹${total}`,
                        "Payment ID": razorpay_payment_id,
                        Status: 'PAID'
                    }]})
                });
            } catch (e) { console.log("SheetDB error:", e.message); }

            // Supabase
            await supabase.from('orders').insert([{
                orderId: orderId,
                customerName: req.session.customerName || 'N/A',
                rollNumber: req.session.rollNumber || 'N/A',
                studentEmail: req.session.studentEmail || 'N/A',
                items: itemsString,
                total: total,
                paymentStatus: 'PAID',
                paymentId: razorpay_payment_id,
                status: 'ORDER_RECEIVED',
                created_at: istTime,
                updatedAt: istTime
            }]);

            return res.json({ success: true, message: 'Payment verified' });
        }
        return res.status(400).json({ success: false, message: 'Invalid signature' });
    } catch (error) {
        return res.status(500).json({ success: false, message: error.message });
    }
});

// ==================== SIGNUP / LOGIN ====================
app.get('/signup', (req, res) => res.render('signup', { error: null }));

app.post('/signup', async (req, res) => {
    const { full_name, email, password } = req.body;
    try {
        const { error } = await supabase.from('users').insert([{ full_name, email, password }]);
        if (error) return res.render('signup', { error: error.message });
        res.redirect('/login');
    } catch (e) {
        res.render('signup', { error: e.message });
    }
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    try {
        const { data, error } = await supabase.from('users').select('*').eq('email', email).single();
        if (error || !data) return res.render("login", { error: "Invalid email or password." });
        if (data.password !== password) return res.render("login", { error: "Invalid email or password." });

        req.session.user = { id: data.id, email: data.email, full_name: data.full_name };
        return res.redirect("/");
    } catch (err) {
        return res.render("login", { error: "Invalid email or password." });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => res.redirect('/login'));
});

// ==================== ADMIN ====================
app.get('/admin-login', (req, res) => res.render('admin-login'));

app.post('/admin-login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_USERNAME && password === ADMIN_PASSWORD) {
        req.session.isAdmin = true;
        res.redirect('/admin/dashboard');
    } else res.send('Invalid credentials! <a href="/admin-login">Try again</a>');
});

app.get('/admin/dashboard', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/admin-login');
    try {
        const { data: orders } = await supabase.from('orders').select('*').order('created_at', { ascending: false });
        const totalOrders = orders ? orders.length : 0;
        const pendingOrders = orders ? orders.filter(o => o.status === 'ORDER_RECEIVED' || o.status === 'ORDER_PREPARED').length : 0;
        const todayRevenue = orders ? orders.filter(o => o.status === 'ORDER_DELIVERED').reduce((s, o) => s + (o.total || 0), 0) : 0;
        res.render('admin-dashboard', {
            orders: orders || [],
            totalOrders, pendingOrders,
            todayRevenue, todayOrders: totalOrders
        });
    } catch (error) {
        res.status(500).send('Error loading dashboard');
    }
});

// ==================== ADMIN: UPDATE ORDER STATUS ====================
app.post('/admin/update-order', async (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/admin-login');
    try {
        const { orderId, status } = req.body;
        const istTime = new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' });
        const { error } = await supabase.from('orders')
            .update({ status, updatedAt: istTime })
            .eq('orderId', orderId);
        if (error) throw error;
        console.log(`✅ Order ${orderId} → ${status}`);
        res.redirect('/admin/dashboard');
    } catch (error) {
        console.error("Update error:", error.message);
        res.redirect('/admin/dashboard');
    }
});

// ==================== ADMIN: UPDATE ORDER WINDOW ====================
app.post('/admin/update-window', (req, res) => {
    if (!req.session.isAdmin) return res.redirect('/admin-login');
    const { isOpen, openTime, closeTime } = req.body;
    const newSettings = { isOpen: isOpen === 'true', openTime: openTime || "08:00", closeTime: closeTime || "17:00" };
    fs.writeFileSync(settingsPath, JSON.stringify(newSettings, null, 2));
    res.redirect('/admin/dashboard');
});

app.get('/admin/logout', (req, res) => {
    req.session.isAdmin = false;
    res.redirect('/admin-login');
});

// ==================== API: GET USER'S ORDER STATUS ====================
app.get('/get-my-order-status', async (req, res) => {
    if (!req.session.user) return res.json({ success: false });
    try {
        const { data } = await supabase.from('orders')
            .select('orderId, status, updatedAt')
            .eq('studentEmail', req.session.user.email)
            .order('created_at', { ascending: false })
            .limit(1).single();
        if (!data) return res.json({ success: false });
        res.json({ success: true, ...data });
    } catch (error) { res.json({ success: false }); }
});

// ==================== START SERVER ====================
app.listen(PORT, '0.0.0.0', () => {
    console.log(`🚀 Server running on http://localhost:${PORT}`);
});

// ==================== MISC ====================
app.get('/get-cart', (req, res) => res.json({ cart: req.session.cart || [] }));
app.post('/update-cart-json', (req, res) => {
    req.session.cart = req.body.cart || [];
    res.json({ success: true });
});
