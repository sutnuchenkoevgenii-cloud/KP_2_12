// Конфігурація Service Worker
const CONFIG = {
    APP_NAME: 'Кав\'ярня Ароматна',
    VERSION: '1.5.0',

    // Кеші
    CACHE_NAMES: {
        STATIC: 'coffee-static-v3',
        DYNAMIC: 'coffee-dynamic-v2',
        API: 'coffee-api-v2',
        IMAGES: 'coffee-images-v1'
    },

    // Стратегії
    STRATEGIES: {
        STATIC: 'CACHE_FIRST',
        API: 'NETWORK_FIRST',
        IMAGES: 'CACHE_FIRST'
    },

    // Файли для прекешування
    PRECACHE_FILES: [
        '/',
        '/index.html',
        '/offline.html',
        '/style.css',
        '/app.js',
        '/manifest.json',
        '/coffee.jpg'
    ],

    // API ендпоінти
    API_ENDPOINTS: [
        '/api/',
        '/api/menu.json'
    ],

    // Максимальний розмір динамічного кешу (10MB)
    MAX_DYNAMIC_CACHE_SIZE: 10 * 1024 * 1024
};

// ========== ІНСТАЛЯЦІЯ ==========
self.addEventListener('install', event => {
    console.log('🛠️ Service Worker: Інсталяція v' + CONFIG.VERSION);

    event.waitUntil(
        Promise.all([
            // Кешувати статичні файли
            precacheStaticFiles(),

            // Очистити старі кеші
            cleanOldCaches(),

            // Активація
            self.skipWaiting()
        ]).then(() => {
            console.log('✅ Service Worker інстальовано');
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_INSTALLED',
                        version: CONFIG.VERSION
                    });
                });
            });
        })
    );
});

// ========== АКТИВАЦІЯ ==========
self.addEventListener('activate', event => {
    console.log('🚀 Service Worker: Активація');

    event.waitUntil(
        Promise.all([
            // Очистити старі кеші
            cleanOldCaches(),

            // Заявити контроль над клієнтами
            self.clients.claim(),

            // Відправити повідомлення про активацію
            notifyClients('SW_ACTIVATED')
        ]).then(() => {
            console.log('✅ Service Worker активовано');
        })
    );
});

// ========== ОБРОБКА ЗАПИТІВ ==========
self.addEventListener('fetch', event => {
    const url = new URL(event.request.url);

    // Пропускати не-GET запити
    if (event.request.method !== 'GET') return;

    // Пропускати chrome-extension та інші спеціальні запити
    if (url.protocol === 'chrome-extension:') return;

    // Визначити стратегію на основі типу запиту
    if (isApiRequest(url)) {
        event.respondWith(handleApiRequest(event));
    } else if (isImageRequest(url)) {
        event.respondWith(handleImageRequest(event));
    } else {
        event.respondWith(handleStaticRequest(event));
    }
});

// ========== СИНХРОНІЗАЦІЯ ==========
self.addEventListener('sync', event => {
    console.log('🔄 Sync подія:', event.tag);

    if (event.tag === 'send-orders') {
        event.waitUntil(syncPendingOrders());
    }

    if (event.tag === 'update-menu') {
        event.waitUntil(updateMenuCache());
    }
});

// ========== PUSH-СПОВІЩЕННЯ ==========
self.addEventListener('push', event => {
    console.log('📢 Push подія отримана');

    const data = event.data ? event.data.json() : {};
    const title = data.title || CONFIG.APP_NAME;
    const options = {
        body: data.body || 'Нове повідомлення від кав\'ярні',
        icon: '/coffee.jpg',
        badge: '/coffee.jpg',
        tag: data.tag || 'coffee-notification',
        data: data.url || '/',
        actions: data.actions || [
            {
                action: 'open',
                title: 'Відкрити'
            },
            {
                action: 'dismiss',
                title: 'Закрити'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(title, options)
    );
});

self.addEventListener('notificationclick', event => {
    console.log('🔔 Клік по сповіщенню:', event.action);

    event.notification.close();

    if (event.action === 'open' || event.action === '') {
        event.waitUntil(
            clients.matchAll({
                type: 'window',
                includeUncontrolled: true
            }).then(clientList => {
                // Спробувати знайти відкритий клієнт
                for (const client of clientList) {
                    if (client.url === '/' && 'focus' in client) {
                        return client.focus();
                    }
                }
                // Якщо не знайдено, відкрити нове вікно
                if (clients.openWindow) {
                    return clients.openWindow(event.notification.data || '/');
                }
            })
        );
    }
});

// ========== ПОВІДОМЛЕННЯ ==========
self.addEventListener('message', event => {
    console.log('📨 Повідомлення від клієнта:', event.data);

    const { type, data } = event.data || {};

    switch (type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;

        case 'UPDATE_CACHE':
            updateSpecificCache(data);
            break;

        case 'CLEAR_CACHE':
            clearAllCaches();
            break;

        case 'GET_STATUS':
            sendStatusToClient(event.source);
            break;
    }
});

// ========== ФУНКЦІЇ ДЛЯ КЕШУВАННЯ ==========
async function precacheStaticFiles() {
    const cache = await caches.open(CONFIG.CACHE_NAMES.STATIC);
    console.log('📦 Прекешування статичних файлів...');

    try {
        await cache.addAll(CONFIG.PRECACHE_FILES);
        console.log(`✅ Прекешовано ${CONFIG.PRECACHE_FILES.length} файлів`);
    } catch (error) {
        console.error('❌ Помилка прекешування:', error);
    }
}

async function cleanOldCaches() {
    const cacheKeys = await caches.keys();
    const currentCaches = Object.values(CONFIG.CACHE_NAMES);

    const cachesToDelete = cacheKeys.filter(key => !currentCaches.includes(key));

    console.log('🧹 Очищення старих кешів:', cachesToDelete);

    return Promise.all(
        cachesToDelete.map(key => {
            console.log(`🗑️ Видалення кешу: ${key}`);
            return caches.delete(key);
        })
    );
}

async function clearAllCaches() {
    const cacheKeys = await caches.keys();
    console.log('🧹 Очищення всіх кешів:', cacheKeys);

    await Promise.all(cacheKeys.map(key => caches.delete(key)));

    notifyClients('CACHE_CLEARED');
    console.log('✅ Всі кеші очищено');
}

// ========== СТРАТЕГІЇ КЕШУВАННЯ ==========
async function handleStaticRequest(event) {
    const cache = await caches.open(CONFIG.CACHE_NAMES.STATIC);

    try {
        // Спочатку кеш
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            console.log('📦 Статичний файл з кешу:', event.request.url);
            return cachedResponse;
        }

        // Потім мережа
        const networkResponse = await fetch(event.request);

        if (networkResponse.ok) {
            // Кешувати для майбутнього використання
            const responseClone = networkResponse.clone();
            cache.put(event.request, responseClone);
            console.log('🌐 Статичний файл з мережі та закешовано:', event.request.url);
        }

        return networkResponse;

    } catch (error) {
        console.error('❌ Помилка завантаження статичного файлу:', error);

        // Для HTML - показати offline.html
        if (event.request.headers.get('accept').includes('text/html')) {
            const offlineResponse = await cache.match('/offline.html');
            if (offlineResponse) return offlineResponse;
        }

        // Fallback
        return new Response('Ресурс недоступний', {
            status: 503,
            headers: { 'Content-Type': 'text/plain' }
        });
    }
}

async function handleApiRequest(event) {
    const cache = await caches.open(CONFIG.CACHE_NAMES.API);
    const url = event.request.url;

    try {
        // Спочатку мережа
        console.log('🌐 API запит до мережі:', url);
        const networkResponse = await fetch(event.request);

        if (networkResponse.ok) {
            // Зберегти в кеш
            const responseClone = networkResponse.clone();
            cache.put(event.request, responseClone);
            console.log('✅ API відповідь закешовано:', url);

            // Сповістити клієнтів про оновлення
            notifyClients('API_UPDATED', { url });

            return networkResponse;
        }

        throw new Error(`HTTP ${networkResponse.status}`);

    } catch (error) {
        console.log('⚫ API невдало, спроба кешу:', url);

        // Спробувати кеш
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            console.log('📦 API з кешу:', url);
            return cachedResponse;
        }

        // Якщо немає в кеші
        console.log('❌ API не знайдено в кеші:', url);
        return new Response(
            JSON.stringify({
                error: 'Офлайн',
                message: 'API недоступне',
                url: url,
                timestamp: new Date().toISOString()
            }),
            {
                status: 503,
                headers: { 'Content-Type': 'application/json' }
            }
        );
    }
}

async function handleImageRequest(event) {
    const cache = await caches.open(CONFIG.CACHE_NAMES.IMAGES);

    try {
        // Спочатку кеш
        const cachedResponse = await cache.match(event.request);
        if (cachedResponse) {
            console.log('🖼️ Зображення з кешу:', event.request.url);
            return cachedResponse;
        }

        // Потім мережа
        const networkResponse = await fetch(event.request);

        if (networkResponse.ok) {
            // Кешувати
            const responseClone = networkResponse.clone();
            cache.put(event.request, responseClone);
            console.log('🌐 Зображення з мережі та закешовано:', event.request.url);
        }

        return networkResponse;

    } catch (error) {
        console.error('❌ Помилка завантаження зображення:', error);

        // Повернути placeholder
        return new Response(
            '<svg width="300" height="300" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#8b4513"/><text x="50%" y="50%" font-family="Arial" font-size="20" fill="white" text-anchor="middle" dy=".3em">Зображення</text></svg>',
            {
                headers: { 'Content-Type': 'image/svg+xml' }
            }
        );
    }
}

// ========== СИНХРОНІЗАЦІЯ ЗАМОВЛЕНЬ ==========
async function syncPendingOrders() {
    console.log('🔄 Початок синхронізації замовлень...');

    try {
        // Отримати всі очікуючі замовлення з localStorage
        const syncKeys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('sync_order_')) {
                syncKeys.push(key);
            }
        }

        if (syncKeys.length === 0) {
            console.log('📭 Немає замовлень для синхронізації');
            notifyClients('SYNC_COMPLETED', { count: 0 });
            return;
        }

        let successCount = 0;
        let errorCount = 0;

        // Синхронізувати кожне замовлення
        for (const key of syncKeys) {
            try {
                const syncData = JSON.parse(localStorage.getItem(key));

                // Імітація відправки на сервер
                console.log(`📤 Синхронізація замовлення: ${syncData.order.id}`);

                // Тут має бути реальний запит до API
                // const response = await fetch('/api/orders', {
                //     method: 'POST',
                //     headers: { 'Content-Type': 'application/json' },
                //     body: JSON.stringify(syncData.order)
                // });

                // if (response.ok) {
                //     localStorage.removeItem(key);
                //     successCount++;
                // } else {
                //     throw new Error(`HTTP ${response.status}`);
                // }

                // Імітація успішної відправки
                await new Promise(resolve => setTimeout(resolve, 500));
                localStorage.removeItem(key);
                successCount++;

                // Сповістити клієнта
                notifyClients('ORDER_SYNCED', { orderId: syncData.order.id });

            } catch (error) {
                console.error(`❌ Помилка синхронізації замовлення ${key}:`, error);
                errorCount++;
            }
        }

        console.log(`✅ Синхронізацію завершено: ${successCount} успішно, ${errorCount} помилок`);

        // Сповістити клієнтів
        notifyClients('SYNC_COMPLETED', {
            success: successCount,
            errors: errorCount,
            total: syncKeys.length
        });

    } catch (error) {
        console.error('❌ Критична помилка синхронізації:', error);
        notifyClients('SYNC_FAILED', { error: error.message });
    }
}

// ========== ДОПОМІЖНІ ФУНКЦІЇ ==========
function isApiRequest(url) {
    return CONFIG.API_ENDPOINTS.some(endpoint =>
        url.pathname.startsWith(endpoint)
    );
}

function isImageRequest(url) {
    return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url.pathname);
}

async function updateMenuCache() {
    console.log('🔄 Оновлення кешу меню...');

    try {
        const cache = await caches.open(CONFIG.CACHE_NAMES.API);
        const response = await fetch('/api/menu.json');

        if (response.ok) {
            await cache.put('/api/menu.json', response.clone());
            console.log('✅ Кеш меню оновлено');
            notifyClients('MENU_UPDATED');
        }
    } catch (error) {
        console.error('❌ Помилка оновлення кешу меню:', error);
    }
}

async function updateSpecificCache(data) {
    if (!data || !data.url) return;

    try {
        const response = await fetch(data.url);
        if (response.ok) {
            // Визначити тип кешу
            let cacheName = CONFIG.CACHE_NAMES.DYNAMIC;
            if (isApiRequest(new URL(data.url))) {
                cacheName = CONFIG.CACHE_NAMES.API;
            } else if (isImageRequest(new URL(data.url))) {
                cacheName = CONFIG.CACHE_NAMES.IMAGES;
            }

            const cache = await caches.open(cacheName);
            await cache.put(data.url, response.clone());

            console.log(`✅ Кеш оновлено: ${data.url}`);
        }
    } catch (error) {
        console.error('❌ Помилка оновлення кешу:', error);
    }
}

async function sendStatusToClient(client) {
    const cacheKeys = await caches.keys();
    const cacheStatus = {};

    // Отримати статус кожного кешу
    for (const key of cacheKeys) {
        const cache = await caches.open(key);
        const requests = await cache.keys();
        cacheStatus[key] = requests.length;
    }

    client.postMessage({
        type: 'SW_STATUS',
        data: {
            version: CONFIG.VERSION,
            caches: cacheStatus,
            strategy: CONFIG.STRATEGIES
        }
    });
}

function notifyClients(type, data = {}) {
    self.clients.matchAll().then(clients => {
        clients.forEach(client => {
            client.postMessage({
                type,
                data: {
                    ...data,
                    timestamp: new Date().toISOString()
                }
            });
        });
    });
}

// ========== ФОНОВА СИНХРОНІЗАЦІЯ ==========
async function manageCacheSize() {
    const cache = await caches.open(CONFIG.CACHE_NAMES.DYNAMIC);
    const requests = await cache.keys();

    let totalSize = 0;
    const entries = [];

    // Обчислити розмір кожного запису
    for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
            const blob = await response.blob();
            totalSize += blob.size;
            entries.push({ request, size: blob.size, timestamp: Date.now() });
        }
    }

    // Якщо розмір перевищує максимальний
    if (totalSize > CONFIG.MAX_DYNAMIC_CACHE_SIZE) {
        // Сортувати за timestamp (старіші перші)
        entries.sort((a, b) => a.timestamp - b.timestamp);

        let sizeToRemove = 0;
        const toRemove = [];

        for (const entry of entries) {
            if (sizeToRemove >= CONFIG.MAX_DYNAMIC_CACHE_SIZE * 0.3) break; // Видалити 30%

            sizeToRemove += entry.size;
            toRemove.push(entry.request);
        }

        // Видалити старі записи
        for (const request of toRemove) {
            await cache.delete(request);
        }

        console.log(`🧹 Очищено ${toRemove.length} записів з динамічного кешу`);
    }
}

// Запускати очищення кешу кожні 30 хвилин
setInterval(manageCacheSize, 30 * 60 * 1000);

console.log('🛠️ Service Worker завантажено та готовий до роботи');