// Конфігурація додатка
const CONFIG = {
    APP_VERSION: '1.5.0',
    API_BASE_URL: '/api',
    CART_STORAGE_KEY: 'coffee_shop_cart',
    ORDERS_STORAGE_KEY: 'coffee_shop_orders',
    MENU_CACHE_KEY: 'menu_cache',
    THEME_STORAGE_KEY: 'coffee_shop_theme'
};

// Глобальні змінні
let serviceWorkerRegistration = null;
let currentSection = 'menu';
let menuData = [];
let cart = [];
let pendingOrders = [];

// Ініціалізація додатка
document.addEventListener('DOMContentLoaded', initializeApp);

async function initializeApp() {
    console.log('🚀 Ініціалізація PWA додатка...');

    try {
        // 1. Встановити тему
        initializeTheme();

        // 2. Зареєструвати Service Worker
        await registerServiceWorker();

        // 3. Ініціалізувати UI
        initializeUI();

        // 4. Завантажити дані
        await loadInitialData();

        // 5. Налаштувати слухачі подій
        setupEventListeners();

        // 6. Оновити статус
        updateConnectionStatus();

        console.log('✅ Додаток ініціалізовано успішно');

    } catch (error) {
        console.error('❌ Помилка ініціалізації:', error);
        showMessage('Помилка ініціалізації додатка', 'error');
    }
}

// ========== THEME MANAGEMENT ==========
function initializeTheme() {
    const savedTheme = localStorage.getItem(CONFIG.THEME_STORAGE_KEY) || 'light';
    document.documentElement.setAttribute('data-theme', savedTheme);
    updateThemeButton(savedTheme);
}

function toggleTheme() {
    const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
    const newTheme = currentTheme === 'light' ? 'dark' : 'light';

    document.documentElement.setAttribute('data-theme', newTheme);
    localStorage.setItem(CONFIG.THEME_STORAGE_KEY, newTheme);
    updateThemeButton(newTheme);
}

function updateThemeButton(theme) {
    const button = document.getElementById('theme-toggle');
    if (button) {
        button.textContent = theme === 'light' ? '🌙' : '☀️';
        button.title = theme === 'light' ? 'Увімкнути темну тему' : 'Увімкнути світлу тему';
    }
}

// ========== SERVICE WORKER ==========
async function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) {
        console.warn('Service Worker не підтримується');
        updateSWStatus('Не підтримується');
        return;
    }

    try {
        serviceWorkerRegistration = await navigator.serviceWorker.register('/sw.js', {
            scope: '/'
        });

        console.log('✅ Service Worker зареєстровано:', serviceWorkerRegistration);
        updateSWStatus('Активний');

        // Слухач для оновлень
        serviceWorkerRegistration.addEventListener('updatefound', handleServiceWorkerUpdate);

        // Слухач для повідомлень від SW
        navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);

        // Слухач для зміни контролера
        navigator.serviceWorker.addEventListener('controllerchange', handleControllerChange);

    } catch (error) {
        console.error('❌ Помилка реєстрації Service Worker:', error);
        updateSWStatus('Помилка реєстрації');
    }
}

function handleServiceWorkerUpdate() {
    const newWorker = serviceWorkerRegistration.installing;

    newWorker.addEventListener('statechange', () => {
        console.log('Service Worker стан:', newWorker.state);

        if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
            showUpdateNotification();
        }
    });
}

function handleServiceWorkerMessage(event) {
    console.log('📨 Повідомлення від Service Worker:', event.data);

    const { type, data } = event.data || {};

    switch (type) {
        case 'CACHE_UPDATED':
            showMessage('Кеш оновлено', 'success');
            break;

        case 'SYNC_COMPLETED':
            showSyncNotification(false);
            showMessage('Синхронізацію завершено', 'success');
            loadPendingOrders();
            break;

        case 'SYNC_FAILED':
            showSyncNotification(false);
            showMessage('Помилка синхронізації', 'error');
            break;

        case 'SYNC_STARTED':
            showSyncNotification(true);
            break;

        case 'NEW_VERSION':
            showUpdateNotification();
            break;
    }
}

function handleControllerChange() {
    console.log('🔄 Контролер Service Worker змінився');
    window.location.reload();
}

// ========== UI MANAGEMENT ==========
function initializeUI() {
    // Оновити версію
    document.getElementById('app-version').textContent = `v${CONFIG.APP_VERSION}`;

    // Завантажити кошик
    loadCart();

    // Показати активну секцію
    showSection('menu');

    // Оновити індикатори
    updateCartBadge();
    updateConnectionStatus();
}

function showSection(sectionId) {
    // Приховати всі секції
    document.querySelectorAll('.content-section').forEach(section => {
        section.classList.remove('active');
    });

    // Оновити активні кнопки навігації
    document.querySelectorAll('.nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Показати вибрану секцію
    const section = document.getElementById(`${sectionId}-section`);
    if (section) {
        section.classList.add('active');
    }

    // Активувати відповідну кнопку навігації
    const navBtn = document.querySelector(`.nav-btn[onclick*="${sectionId}"]`);
    if (navBtn) {
        navBtn.classList.add('active');
    }

    currentSection = sectionId;

    // Якщо це секція замовлень - завантажити їх
    if (sectionId === 'orders') {
        loadOrders();
        loadPendingOrders();
    }
}

// ========== DATA LOADING ==========
async function loadInitialData() {
    await Promise.all([
        loadMenu(),
        loadOrders(),
        loadPendingOrders()
    ]);
}

async function loadMenu(forceRefresh = false) {
    const menuContainer = document.getElementById('menu-container');
    const menuStatus = document.getElementById('menu-status');

    if (!menuContainer || !menuStatus) return;

    // Показати стан завантаження
    menuContainer.innerHTML = `
        <div class="loading-state">
            <div class="spinner"></div>
            <p>Завантаження меню...</p>
        </div>
    `;
    menuStatus.textContent = 'Завантаження меню...';
    menuStatus.style.color = 'var(--info-color)';

    try {
        const cacheKey = CONFIG.MENU_CACHE_KEY;
        const cacheTimestamp = localStorage.getItem(`${cacheKey}_timestamp`);
        const cacheAge = cacheTimestamp ? Date.now() - parseInt(cacheTimestamp) : Infinity;

        // Якщо не примусове оновлення і кеш свіжий (< 5 хвилин)
        if (!forceRefresh && cacheAge < 5 * 60 * 1000) {
            const cachedData = localStorage.getItem(cacheKey);
            if (cachedData) {
                menuData = JSON.parse(cachedData);
                console.log('📦 Меню завантажено з кешу');
                renderMenu();
                menuStatus.textContent = 'Меню завантажено з кешу';
                menuStatus.style.color = 'var(--success-color)';
                return;
            }
        }

        // Завантаження з мережі
        console.log('🌐 Завантаження меню з мережі...');
        menuStatus.textContent = 'Завантаження з мережі...';

        const response = await fetch(`${CONFIG.API_BASE_URL}/menu.json`, {
            headers: {
                'Cache-Control': 'no-cache'
            }
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        menuData = await response.json();

        // Зберегти в кеш
        localStorage.setItem(cacheKey, JSON.stringify(menuData));
        localStorage.setItem(`${cacheKey}_timestamp`, Date.now().toString());

        console.log('✅ Меню завантажено з мережі:', menuData.length, 'елементів');
        renderMenu();

        menuStatus.textContent = `Меню оновлено (${menuData.length} напоїв)`;
        menuStatus.style.color = 'var(--success-color)';

        // Повідомити про успішне оновлення
        if (forceRefresh) {
            showMessage('Меню оновлено', 'success');
        }

    } catch (error) {
        console.error('❌ Помилка завантаження меню:', error);

        // Спробувати використати старий кеш
        const cachedData = localStorage.getItem(CONFIG.MENU_CACHE_KEY);
        if (cachedData) {
            menuData = JSON.parse(cachedData);
            renderMenu();
            menuStatus.textContent = 'Меню з кешу (офлайн)';
            menuStatus.style.color = 'var(--warning-color)';
            showMessage('Використовується кешоване меню', 'warning');
        } else {
            menuContainer.innerHTML = `
                <div class="empty-state">
                    <h3>Не вдалося завантажити меню</h3>
                    <p>${error.message}</p>
                    <button onclick="loadMenu(true)" class="btn btn-primary">
                        Спробувати знову
                    </button>
                </div>
            `;
            menuStatus.textContent = 'Помилка завантаження';
            menuStatus.style.color = 'var(--error-color)';
        }
    }
}

function renderMenu() {
    const menuContainer = document.getElementById('menu-container');
    if (!menuContainer || !menuData.length) return;

    const filter = document.getElementById('category-filter')?.value || 'all';

    let filteredData = menuData;
    if (filter !== 'all') {
        filteredData = menuData.filter(item => item.category === filter);
    }

    menuContainer.innerHTML = filteredData.map(item => `
        <div class="coffee-card ${item.popular ? 'popular' : ''}">
            <img src="coffee.jpg" alt="${item.name}" class="card-image" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 300 300%22><rect width=%22100%25%22 height=%22100%25%22 fill=%22%238b4513%22/><text x=%2250%25%22 y=%2250%25%22 font-family=%22Arial%22 font-size=%2220%22 fill=%22white%22 text-anchor=%22middle%22 dy=%22.3em%22>${encodeURIComponent(item.name)}</text></svg>'">
            <div class="card-content">
                <div class="card-header">
                    <h3 class="card-title">${item.name}</h3>
                    <div class="card-price">${item.price} ₴</div>
                </div>
                <div class="card-category">${item.category}</div>
                <p class="card-description">${item.description}</p>
                <div class="card-footer">
                    <div class="card-source">
                        ${navigator.onLine ? '🟢 Онлайн' : '⚫ Офлайн'}
                    </div>
                    <button onclick="addToCart(${item.id})" class="btn btn-primary btn-sm">
                        <span class="btn-icon">🛒</span> Замовити
                    </button>
                </div>
            </div>
        </div>
    `).join('');

    // Оновити статус
    const menuStatus = document.getElementById('menu-status');
    if (menuStatus) {
        const count = filteredData.length;
        const suffix = count === 1 ? 'напій' : (count < 5 ? 'напої' : 'напоїв');
        menuStatus.textContent = `Показано ${count} ${suffix}`;
    }
}

function filterMenu() {
    renderMenu();
}

// ========== CART MANAGEMENT ==========
function loadCart() {
    try {
        const savedCart = localStorage.getItem(CONFIG.CART_STORAGE_KEY);
        cart = savedCart ? JSON.parse(savedCart) : [];
        updateCartBadge();
    } catch (error) {
        console.error('❌ Помилка завантаження кошика:', error);
        cart = [];
    }
}

function saveCart() {
    try {
        localStorage.setItem(CONFIG.CART_STORAGE_KEY, JSON.stringify(cart));
        updateCartBadge();
    } catch (error) {
        console.error('❌ Помилка збереження кошика:', error);
    }
}

async function addToCart(itemId) {
    const item = menuData.find(i => i.id === itemId);
    if (!item) {
        showMessage('Товар не знайдено', 'error');
        return;
    }

    cart.push({
        id: Date.now(),
        itemId: item.id,
        name: item.name,
        price: item.price,
        timestamp: new Date().toISOString()
    });

    saveCart();
    showMessage(`"${item.name}" додано до кошика`, 'success');
}

function removeFromCart(cartItemId) {
    cart = cart.filter(item => item.id !== cartItemId);
    saveCart();
    renderCart();
}

function renderCart() {
    const cartItems = document.getElementById('cart-items');
    const cartTotal = document.getElementById('cart-total');

    if (!cartItems || !cartTotal) return;

    if (cart.length === 0) {
        cartItems.innerHTML = '<p class="empty-state">Кошик порожній</p>';
        cartTotal.textContent = '0 ₴';
        return;
    }

    const total = cart.reduce((sum, item) => sum + item.price, 0);

    cartItems.innerHTML = cart.map(item => `
        <div class="cart-item">
            <div class="item-info">
                <h4>${item.name}</h4>
                <p class="item-price">${item.price} ₴</p>
                <p class="item-time">${new Date(item.timestamp).toLocaleTimeString('uk-UA')}</p>
            </div>
            <button onclick="removeFromCart(${item.id})" class="btn btn-sm btn-secondary">
                Видалити
            </button>
        </div>
    `).join('');

    cartTotal.textContent = `${total} ₴`;
}

function updateCartBadge() {
    const cartCount = document.getElementById('cart-count');
    if (cartCount) {
        cartCount.textContent = cart.length > 99 ? '99+' : cart.length;
        cartCount.style.display = cart.length > 0 ? 'flex' : 'none';
    }
}

function showCart() {
    renderCart();
    document.getElementById('cart-modal').classList.remove('hidden');
}

function closeCart() {
    document.getElementById('cart-modal').classList.add('hidden');
}

async function checkout() {
    if (cart.length === 0) {
        showMessage('Кошик порожній', 'warning');
        return;
    }

    const order = {
        id: `order_${Date.now()}`,
        items: [...cart],
        total: cart.reduce((sum, item) => sum + item.price, 0),
        timestamp: new Date().toISOString(),
        status: 'pending'
    };

    // Очистити кошик
    cart = [];
    saveCart();
    closeCart();

    // Додати до очікуючих замовлень
    pendingOrders.push(order);
    savePendingOrders();

    // Синхронізувати
    await syncOrder(order);

    showMessage('Замовлення оформлено!', 'success');
    if (currentSection === 'orders') {
        loadOrders();
        loadPendingOrders();
    }
}

// ========== ORDERS & SYNC ==========
function loadOrders() {
    try {
        const savedOrders = localStorage.getItem(CONFIG.ORDERS_STORAGE_KEY);
        const orders = savedOrders ? JSON.parse(savedOrders) : [];

        const ordersContainer = document.getElementById('orders-container');
        if (!ordersContainer) return;

        if (orders.length === 0) {
            ordersContainer.innerHTML = `
                <div class="empty-state">
                    <p>Немає замовлень</p>
                    <button onclick="showSection('menu')" class="btn btn-secondary">
                        Перейти до меню
                    </button>
                </div>
            `;
            return;
        }

        ordersContainer.innerHTML = orders.map(order => `
            <div class="order-card">
                <div class="order-header">
                    <h4>Замовлення #${order.id.slice(-6)}</h4>
                    <span class="order-status ${order.status}">${getStatusText(order.status)}</span>
                </div>
                <div class="order-details">
                    <p><strong>Сума:</strong> ${order.total} ₴</p>
                    <p><strong>Час:</strong> ${new Date(order.timestamp).toLocaleString('uk-UA')}</p>
                    <p><strong>Кількість:</strong> ${order.items.length} позицій</p>
                </div>
                <div class="order-items">
                    ${order.items.map(item => `
                        <div class="order-item">
                            <span>${item.name}</span>
                            <span>${item.price} ₴</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `).join('');

    } catch (error) {
        console.error('❌ Помилка завантаження замовлень:', error);
    }
}

function loadPendingOrders() {
    try {
        const saved = localStorage.getItem('pending_orders');
        pendingOrders = saved ? JSON.parse(saved) : [];

        document.getElementById('pending-orders').textContent = pendingOrders.length;

        const pendingList = document.getElementById('pending-list');
        if (pendingList) {
            if (pendingOrders.length === 0) {
                pendingList.innerHTML = '<p class="empty-state">Немає очікуючих замовлень</p>';
            } else {
                pendingList.innerHTML = pendingOrders.map(order => `
                    <div class="pending-order">
                        <span>#${order.id.slice(-6)}</span>
                        <span>${order.items.length} позицій</span>
                        <span>${order.total} ₴</span>
                    </div>
                `).join('');
            }
        }

    } catch (error) {
        console.error('❌ Помилка завантаження очікуючих замовлень:', error);
    }
}

function savePendingOrders() {
    try {
        localStorage.setItem('pending_orders', JSON.stringify(pendingOrders));
        loadPendingOrders();
    } catch (error) {
        console.error('❌ Помилка збереження очікуючих замовлень:', error);
    }
}

async function syncOrder(order) {
    if (!('serviceWorker' in navigator) || !('SyncManager' in window)) {
        console.warn('Background Sync не підтримується');
        // Імітуємо синхронізацію
        setTimeout(() => completeOrderSync(order), 2000);
        return;
    }

    try {
        const registration = await navigator.serviceWorker.ready;

        // Зберегти замовлення для синхронізації
        const syncData = {
            type: 'ORDER',
            order: order
        };

        localStorage.setItem(`sync_order_${order.id}`, JSON.stringify(syncData));

        // Зареєструвати синхронізацію
        await registration.sync.register('send-orders');

        console.log('🔄 Синхронізацію зареєстровано');
        showSyncNotification(true);

    } catch (error) {
        console.error('❌ Помилка реєстрації синхронізації:', error);
        // Додати до черги для повторної спроби
        pendingOrders.push(order);
        savePendingOrders();
    }
}

async function syncOrders() {
    if (pendingOrders.length === 0) {
        showMessage('Немає замовлень для синхронізації', 'info');
        return;
    }

    showSyncNotification(true);

    // Синхронізувати всі очікуючі замовлення
    for (const order of [...pendingOrders]) {
        await syncOrder(order);
    }
}

function completeOrderSync(order) {
    // Видалити з очікуючих
    pendingOrders = pendingOrders.filter(o => o.id !== order.id);
    savePendingOrders();

    // Додати до виконаних
    const savedOrders = JSON.parse(localStorage.getItem(CONFIG.ORDERS_STORAGE_KEY) || '[]');
    savedOrders.push({
        ...order,
        status: 'completed',
        syncedAt: new Date().toISOString()
    });
    localStorage.setItem(CONFIG.ORDERS_STORAGE_KEY, JSON.stringify(savedOrders));

    // Оновити UI
    loadOrders();
    loadPendingOrders();

    showMessage(`Замовлення #${order.id.slice(-6)} відправлено`, 'success');
}

function getStatusText(status) {
    const statusMap = {
        'pending': 'В обробці',
        'completed': 'Виконано',
        'failed': 'Помилка'
    };
    return statusMap[status] || status;
}

// ========== NOTIFICATIONS & MESSAGES ==========
function showMessage(text, type = 'info') {
    // Створити сповіщення
    const notification = document.createElement('div');
    notification.className = `message-notification ${type}`;
    notification.innerHTML = `
        <span class="message-icon">${getMessageIcon(type)}</span>
        <span class="message-text">${text}</span>
        <button onclick="this.parentElement.remove()" class="message-close">×</button>
    `;

    // Додати стилі
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 16px 20px;
        border-radius: var(--border-radius);
        background: var(--surface-color);
        color: var(--text-color);
        box-shadow: var(--shadow-hover);
        display: flex;
        align-items: center;
        gap: 12px;
        z-index: 1000;
        animation: slideInRight 0.3s ease-out;
        min-width: 300px;
        max-width: 400px;
    `;

    // Колір іконки
    const colorMap = {
        success: 'var(--success-color)',
        error: 'var(--error-color)',
        warning: 'var(--warning-color)',
        info: 'var(--info-color)'
    };

    notification.querySelector('.message-icon').style.color = colorMap[type] || colorMap.info;

    // Додати на сторінку
    document.body.appendChild(notification);

    // Автоматично видалити через 5 секунд
    setTimeout(() => {
        if (notification.parentElement) {
            notification.style.animation = 'slideInRight 0.3s ease-out reverse';
            setTimeout(() => notification.remove(), 300);
        }
    }, 5000);
}

function getMessageIcon(type) {
    const iconMap = {
        success: '✅',
        error: '❌',
        warning: '⚠️',
        info: 'ℹ️'
    };
    return iconMap[type] || 'ℹ️';
}

function showUpdateNotification() {
    document.getElementById('update-notification').classList.remove('hidden');
}

function dismissUpdate() {
    document.getElementById('update-notification').classList.add('hidden');
}

function applyUpdate() {
    if (serviceWorkerRegistration && serviceWorkerRegistration.waiting) {
        // Відправити команду оновлення
        serviceWorkerRegistration.waiting.postMessage({ type: 'SKIP_WAITING' });
    } else {
        window.location.reload();
    }
}

function showSyncNotification(show) {
    const notification = document.getElementById('sync-notification');
    if (notification) {
        notification.classList.toggle('hidden', !show);
    }
}

// ========== UTILITY FUNCTIONS ==========
function updateConnectionStatus() {
    const statusElement = document.getElementById('connection-status');
    const debugOnline = document.getElementById('debug-online');
    const connectionType = document.getElementById('connection-type');

    if (navigator.onLine) {
        statusElement.textContent = 'Онлайн';
        statusElement.className = 'online';

        // Приховати офлайн індикатор
        document.getElementById('offline-indicator').classList.add('hidden');
    } else {
        statusElement.textContent = 'Офлайн';
        statusElement.className = 'offline';

        // Показати офлайн індикатор
        document.getElementById('offline-indicator').classList.remove('hidden');
    }

    if (debugOnline) debugOnline.textContent = navigator.onLine;
    if (connectionType) {
        connectionType.textContent = navigator.connection ?
            (navigator.connection.effectiveType || 'unknown') : 'unknown';
    }
}

function dismissIndicator() {
    document.getElementById('offline-indicator').classList.add('hidden');
}

function updateSWStatus(status) {
    const element = document.getElementById('sw-status');
    if (element) {
        element.textContent = status;
        element.className = status === 'Активний' ? 'online' :
            status === 'Помилка' ? 'error' : '';
    }
}

async function checkForUpdates() {
    if (!serviceWorkerRegistration) {
        showMessage('Service Worker не зареєстровано', 'error');
        return;
    }

    try {
        await serviceWorkerRegistration.update();
        showMessage('Перевірку оновлень виконано', 'info');
    } catch (error) {
        console.error('❌ Помилка перевірки оновлень:', error);
        showMessage('Помилка перевірки оновлень', 'error');
    }
}

async function updateSW() {
    if (!serviceWorkerRegistration) {
        showMessage('Service Worker не зареєстровано', 'error');
        return;
    }

    try {
        await serviceWorkerRegistration.update();
        window.location.reload();
    } catch (error) {
        console.error('❌ Помилка оновлення:', error);
        showMessage('Помилка оновлення', 'error');
    }
}

async function clearCache() {
    if (!confirm('Видалити весь кеш? Це призведе до перезавантаження сторінки.')) {
        return;
    }

    try {
        // Очистити Cache Storage
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));

        // Очистити localStorage
        localStorage.clear();

        // Очистити sessionStorage
        sessionStorage.clear();

        // Перезавантажити сторінку
        window.location.reload();

    } catch (error) {
        console.error('❌ Помилка очищення кешу:', error);
        showMessage('Помилка очищення кешу', 'error');
    }
}

function toggleDebug() {
    document.getElementById('debug-panel').classList.toggle('hidden');
    updateDebugInfo();
}

function updateDebugInfo() {
    // Розмір localStorage
    let localStorageSize = 0;
    for (let key in localStorage) {
        if (localStorage.hasOwnProperty(key)) {
            localStorageSize += localStorage.getItem(key).length * 2;
        }
    }
    document.getElementById('localstorage-size').textContent =
        `${Math.round(localStorageSize / 1024)} KB`;

    // Розмір кешу
    caches.keys().then(keys => {
        Promise.all(keys.map(name =>
            caches.open(name).then(cache =>
                cache.keys().then(requests =>
                    Promise.all(requests.map(req =>
                        cache.match(req).then(res => res ? res.blob() : null)
                    ))
                )
            )
        )).then(results => {
            let totalSize = 0;
            results.flat().forEach(blob => {
                if (blob) totalSize += blob.size;
            });
            document.getElementById('cache-size').textContent =
                `${Math.round(totalSize / 1024)} KB`;
        });
    });
}

async function forceUpdate() {
    if (serviceWorkerRegistration) {
        await serviceWorkerRegistration.unregister();
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.map(name => caches.delete(name)));
        localStorage.clear();
        window.location.reload();
    }
}

// ========== EVENT LISTENERS ==========
function setupEventListeners() {
    // Слухачі мережі
    window.addEventListener('online', updateConnectionStatus);
    window.addEventListener('offline', updateConnectionStatus);

    // Слухачі Service Worker
    navigator.serviceWorker?.addEventListener('message', handleServiceWorkerMessage);

    // Автоматичне оновлення меню при онлайні
    window.addEventListener('online', () => {
        loadMenu(true);
        if (pendingOrders.length > 0) {
            syncOrders();
        }
    });

    // Периодичне оновлення
    setInterval(() => {
        if (navigator.onLine) {
            loadMenu();
        }
    }, 5 * 60 * 1000); // Кожні 5 хвилин
}

// ========== PUBLIC API ==========
// Експортуємо функції, які використовуються в HTML
window.showSection = showSection;
window.addToCart = addToCart;
window.removeFromCart = removeFromCart;
window.showCart = showCart;
window.closeCart = closeCart;
window.checkout = checkout;
window.loadMenu = loadMenu;
window.filterMenu = filterMenu;
window.checkForUpdates = checkForUpdates;
window.updateSW = updateSW;
window.applyUpdate = applyUpdate;
window.dismissUpdate = dismissUpdate;
window.syncOrders = syncOrders;
window.toggleTheme = toggleTheme;
window.clearCache = clearCache;
window.toggleDebug = toggleDebug;
window.forceUpdate = forceUpdate;
window.dismissIndicator = dismissIndicator;

console.log('📱 Кав\'ярня «Ароматна» PWA готовий до роботи!');