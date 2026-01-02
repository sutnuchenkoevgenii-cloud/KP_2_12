// Імітація API сервера для обробки замовлень
// Цей файл можна розмістити на сервері або використовувати локально

const express = require('express');
const app = express();
const PORT = process.env.PORT || 3001;

app.use(express.json());
app.use(express.static('..')); // Для обслуговування статичних файлів

// Middleware для CORS
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Імітація бази даних замовлень
let ordersDatabase = [];
let orderCounter = 1000;

// Ендпоінт для отримання меню
app.get('/api/menu.json', (req, res) => {
    const fs = require('fs');
    const path = require('path');

    try {
        const menuPath = path.join(__dirname, 'menu.json');
        const menuData = JSON.parse(fs.readFileSync(menuPath, 'utf8'));
        res.json(menuData);
    } catch (error) {
        console.error('Помилка завантаження меню:', error);
        res.status(500).json({ error: 'Не вдалося завантажити меню' });
    }
});

// Ендпоінт для відправки замовлення
app.post('/api/send-order', (req, res) => {
    const order = req.body;

    console.log('📦 Отримано нове замовлення:', order);

    // Валідація замовлення
    if (!order || !order.items || order.items.length === 0) {
        return res.status(400).json({
            success: false,
            message: 'Неправильний формат замовлення'
        });
    }

    // Додати метадані до замовлення
    const enhancedOrder = {
        ...order,
        id: `ORD${orderCounter++}`,
        receivedAt: new Date().toISOString(),
        status: 'processing',
        estimatedTime: '15-20 хвилин'
    };

    // Зберегти в "базу даних"
    ordersDatabase.push(enhancedOrder);

    // Імітувати затримку обробки
    setTimeout(() => {
        console.log('✅ Замовлення оброблено:', enhancedOrder.id);

        res.json({
            success: true,
            message: 'Замовлення прийнято',
            order: enhancedOrder,
            queuePosition: ordersDatabase.length
        });
    }, 1000);
});

// Ендпоінт для перевірки статусу замовлення
app.get('/api/order-status/:orderId', (req, res) => {
    const orderId = req.params.orderId;
    const order = ordersDatabase.find(o => o.id === orderId);

    if (!order) {
        return res.status(404).json({
            success: false,
            message: 'Замовлення не знайдено'
        });
    }

    res.json({
        success: true,
        order: order,
        timestamp: new Date().toISOString()
    });
});

// Ендпоінт для синхронізації офлайн-замовлень
app.post('/api/sync-orders', (req, res) => {
    const pendingOrders = req.body.orders || [];

    console.log(`🔄 Синхронізація ${pendingOrders.length} замовлень`);

    const results = pendingOrders.map(order => {
        const enhancedOrder = {
            ...order,
            id: `ORD${orderCounter++}`,
            receivedAt: new Date().toISOString(),
            status: 'synced',
            synced: true,
            originalId: order.id
        };

        ordersDatabase.push(enhancedOrder);

        return {
            originalId: order.id,
            newId: enhancedOrder.id,
            success: true
        };
    });

    res.json({
        success: true,
        message: `Синхронізовано ${results.length} замовлень`,
        results: results
    });
});

// Ендпоінт для отримання статистики
app.get('/api/stats', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const todayOrders = ordersDatabase.filter(order =>
        order.receivedAt && order.receivedAt.startsWith(today)
    );

    res.json({
        totalOrders: ordersDatabase.length,
        todayOrders: todayOrders.length,
        popularItems: getPopularItems(),
        averageOrderValue: calculateAverageOrderValue(),
        lastOrder: ordersDatabase[ordersDatabase.length - 1] || null
    });
});

// Допоміжні функції
function getPopularItems() {
    const itemCount = {};

    ordersDatabase.forEach(order => {
        if (order.items) {
            order.items.forEach(item => {
                itemCount[item.name] = (itemCount[item.name] || 0) + 1;
            });
        }
    });

    return Object.entries(itemCount)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([name, count]) => ({ name, count }));
}

function calculateAverageOrderValue() {
    if (ordersDatabase.length === 0) return 0;

    const total = ordersDatabase.reduce((sum, order) => {
        return sum + (order.total || 0);
    }, 0);

    return Math.round(total / ordersDatabase.length);
}

// Запуск сервера
app.listen(PORT, () => {
    console.log(`🚀 Сервер API запущено на порті ${PORT}`);
    console.log(`📱 Меню доступне за адресою: http://localhost:${PORT}/api/menu.json`);
    console.log(`📦 Відправка замовлень: POST http://localhost:${PORT}/api/send-order`);
});

// Для експорту в модуль CommonJS
module.exports = app;