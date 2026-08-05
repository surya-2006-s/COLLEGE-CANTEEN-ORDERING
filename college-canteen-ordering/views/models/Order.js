const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    classroom: {
        type: String,
        required: true
    },
    items: [{
        id: Number,
        name: String,
        price: Number,
        category: String,
        quantity: Number
    }],
    total: {
        type: Number,
        required: true
    },
    upiId: {
        type: String
    },
    transactionId: {
        type: String
    },
    idPhoto: {
        type: String
    },
    status: {
        type: String,
        enum: ['pending', 'preparing', 'ready', 'delivered'],
        default: 'pending'
    },
    createdAt: {
        type: Date,
        default: Date.now
    }
});

module.exports = mongoose.model('Order', orderSchema);
