/**
 * Papelería Roger - Advanced Corporate Architecture Engine
 */

// 1. DATA ACCESS LAYER (Encapsulación de Base de Datos)
class DatabaseService {
    constructor(dbName, version) {
        this.dbName = dbName;
        this.version = version;
        this.db = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);
            request.onerror = () => reject('Fallo de conexión a IndexedDB.');
            request.onsuccess = (e) => { this.db = e.target.result; resolve(); };
            request.onupgradeneeded = (e) => {
                const database = e.target.result;
                const stores = ['articulos', 'ventas', 'gastos', 'creditos'];
                stores.forEach(store => {
                    if (!database.objectStoreNames.contains(store)) {
                        database.createObjectStore(store, { 
                            keyPath: store === 'articulos' ? 'barcode' : 'id', 
                            autoIncrement: store !== 'articulos' 
                        });
                    }
                });
            };
        });
    }

    getAll(storeName) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([storeName], 'readonly');
            const request = transaction.objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result);
        });
    }

    save(storeName, item) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            transaction.objectStore(storeName).put(item).onsuccess = () => resolve();
        });
    }

    delete(storeName, key) {
        return new Promise((resolve) => {
            const transaction = this.db.transaction([storeName], 'readwrite');
            transaction.objectStore(storeName).delete(key).onsuccess = () => resolve();
        });
    }
}

// 2. CORE DOMAIN BUSINESS SERVICES (Reglas de Negocio)
class InventoryService {
    constructor(dbService) {
        this.db = dbService;
    }

    async fetchItems() {
        return await this.db.getAll('articulos');
    }

    async persistItem(item) {
        await this.db.save('articulos', item);
    }

    async removeItem(barcode) {
        await this.db.delete('articulos', barcode);
    }
}

class SalesService {
    constructor(dbService) {
        this.db = dbService;
        this.cart = [];
    }

    clearCart() { this.cart = []; }

    addService(description, price) {
        this.cart.push({ barcode: `SRV-${Date.now()}`, name: description, price: parseFloat(price), qty: 1, isService: true });
    }

    addProduct(product) {
        const itemInCart = this.cart.find(c => c.barcode === product.barcode);
        if (itemInCart) {
            itemInCart.qty++;
        } else {
            this.cart.push({ barcode: product.barcode, name: product.name, price: product.price, qty: 1, isService: false });
        }
    }

    updateQuantity(index, qty) {
        if (qty <= 0) { this.cart.splice(index, 1); } else { this.cart[index].qty = qty; }
    }

    getCartTotal() {
        return this.cart.reduce((acc, i) => acc + (i.price * i.qty), 0);
    }
}

// 3. APPLICATION ORCHESTRATOR & UI MEDIATOR (Controlador Central)
class AppEngine {
    constructor() {
        this.db = new DatabaseService('PapeleriaRogerDB', 3);
        this.inventory = new InventoryService(this.db);
        this.sales = new SalesService(this.db);
        this.cachedItems = [];
    }

    async bootstrap() {
        try {
            await this.db.connect();
            this.cachedItems = await this.inventory.fetchItems();
            this.bindEvents();
            this.renderInventoryTable();
            this.renderCartView();
        } catch (error) {
            console.error("Critical Engine Boot Exception:", error);
        }
    }

    bindEvents() {
        // Tab system
        document.getElementById('main-nav-tabs').addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(btn.dataset.tab).classList.add('active');
            btn.classList.add('active');
            if (btn.dataset.tab === 'tab-caja') { this.renderCorteCaja(); this.renderCreditsTable(); }
        });

        // Form Submission
        document.getElementById('product-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (!e.target.checkValidity()) return this.toast('Completa los campos correctamente.', true);

            let barcode = document.getElementById('barcode').value.trim() || `ART-${Math.floor(1000 + Math.random() * 9000)}`;
            const item = {
                barcode,
                name: document.getElementById('name').value.trim(),
                category: document.getElementById('category').value,
                price: parseFloat(document.getElementById('price').value),
                stock: parseInt(document.getElementById('stock').value, 10),
                minStock: parseInt(document.getElementById('min-stock').value, 10)
            };
            await this.inventory.persistItem(item);
            this.toast('Artículo guardado exitosamente.');
            e.target.reset();
            document.getElementById('product-id').value = '';
            document.getElementById('barcode').disabled = false;
            document.getElementById('form-title').textContent = 'Agregar Nuevo Artículo';
            document.getElementById('btn-cancel').style.display = 'none';
            this.cachedItems = await this.inventory.fetchItems();
            this.renderInventoryTable();
        });

        // Live Filters
        document.getElementById('search-input').addEventListener('input', () => this.renderInventoryTable());
        document.getElementById('filter-stock').addEventListener('change', () => this.renderInventoryTable());

        // Quick Services
        document.getElementById('quick-services-container').addEventListener('click', (e) => {
            const btn = e.target.closest('.btn-quick');
            if (!btn) return;
            this.sales.addService(btn.dataset.desc, btn.dataset.price);
            this.renderCartView();
        });

        // Sale Autocomplete
        const searchSaleInput = document.getElementById('search-sale-input');
        const saleResults = document.getElementById('sale-search-results');
        searchSaleInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase().trim();
            if (!val) { saleResults.style.display = 'none'; return; }
            const matches = this.cachedItems.filter(i => i.name.toLowerCase().includes(val)).slice(0, 5);
            if (!matches.length) { saleResults.innerHTML = '<p style="padding:0.5rem;color:gray;">Sin resultados</p>'; saleResults.style.display = 'block'; return; }
            saleResults.innerHTML = matches.map(m => `<div class="search-item-row" data-barcode="${m.barcode}" style="padding:0.6rem;cursor:pointer;border-bottom:1px solid #eee;">🎯 <strong>${m.name}</strong> - $${m.price.toFixed(2)}</div>`).join('');
            saleResults.style.display = 'block';
        });

        saleResults.addEventListener('click', (e) => {
            const row = e.target.closest('.search-item-row');
            if (!row) return;
            const item = this.cachedItems.find(i => i.barcode === row.dataset.barcode);
            if (item) this.sales.addProduct(item);
            searchSaleInput.value = '';
            saleResults.style.display = 'none';
            this.renderCartView();
        });

        document.getElementById('cash-received').addEventListener('input', () => this.calculateChange());
        document.getElementById('btn-checkout').addEventListener('click', () => this.checkout());
        document.getElementById('btn-set-caja-inicial').addEventListener('click', () => {
            localStorage.setItem('fondo_inicial_roger', parseFloat(document.getElementById('caja-inicial-input').value) || 0);
            this.toast('Caja chica inicial configurada.');
        });

        document.getElementById('expense-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const desc = document.getElementById('expense-desc').value.trim();
            const amount = parseFloat(document.getElementById('expense-amount').value) || 0;
            await this.db.save('gastos', { date: new Date().toISOString(), description: desc, total: amount });
            this.toast('Salida monetaria registrada.');
            e.target.reset();
            this.renderCorteCaja();
        });

        document.getElementById('credit-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const name = document.getElementById('credit-name').value.trim();
            const desc = document.getElementById('credit-desc').value.trim();
            const amount = parseFloat(document.getElementById('credit-amount').value) || 0;
            await this.db.save('creditos', { name, description: desc, total: amount, date: new Date().toISOString() });
            this.toast('Cuenta corriente (fiado) guardada.');
            e.target.reset();
            this.renderCreditsTable();
        });

        // Top actions
        document.getElementById('btn-export').addEventListener('click', () => {
            const blob = new Blob([JSON.stringify(this.cachedItems, null, 2)], { type: 'application/json' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `Respaldo_Roger.json`;
            a.click();
        });

        document.getElementById('btn-trigger-import').addEventListener('click', () => document.getElementById('import-file').click());
        document.getElementById('import-file').addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (evt) => {
                try {
                    const items = JSON.parse(evt.target.result);
                    for (const item of items) { if(item.barcode) await this.db.save('articulos', item); }
                    this.toast('Ecosistema restaurado correctamente.');
                    this.cachedItems = await this.inventory.fetchItems();
                    this.renderInventoryTable();
                } catch { this.toast('Fichero de datos corrupto.', true); }
            };
            reader.readAsText(file);
        });

        document.getElementById('btn-excel').addEventListener('click', () => {
            let csv = "\uFEFFCódigo,Nombre,Categoría,Precio,Existencia,Valor total\n";
            this.cachedItems.forEach(i => { csv += `"${i.barcode}","${i.name}",${i.category},${i.price},${i.stock},${i.price*i.stock}\n`; });
            const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `Reporte_Inventario.csv`;
            a.click();
        });
    }

    renderInventoryTable() {
        const tbody = document.getElementById('inventory-table-body');
        const query = document.getElementById('search-input').value.toLowerCase().trim();
        const filter = document.getElementById('filter-stock').value;

        const filtered = this.cachedItems.filter(item => {
            const matches = item.name.toLowerCase().includes(query) || item.barcode.toLowerCase().includes(query);
            if (filter === 'low') return matches && (item.stock <= item.minStock);
            if (filter === 'resurtir') return matches && (item.stock === 0);
            return matches;
        });

        if (!filtered.length) { tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;">Sin registros correlacionados.</td></tr>'; return; }

        tbody.innerHTML = filtered.map(item => {
            let badge = 'stock-normal';
            if (item.stock === 0) badge = 'stock-empty';
            else if (item.stock <= item.minStock) badge = 'stock-low';
            return `<tr>
                <td><code>${this.escape(item.barcode)}</code></td>
                <td><strong>${this.escape(item.name)}</strong></td>
                <td>${this.escape(item.category)}</td>
                <td>$${item.price.toFixed(2)}</td>
                <td><span class="stock-badge ${badge}">${item.stock} pz</span></td>
                <td class="actions">
                    <button class="btn btn-action btn-edit-trigger" data-barcode="${item.barcode}">Editar</button>
                    <button class="btn btn-danger btn-action btn-delete-trigger" data-barcode="${item.barcode}">Eliminar</button>
                </td>
            </tr>`;
        }).join('');

        // Dynamic element binding via DOM query to bypass global namespace polluting
        tbody.querySelectorAll('.btn-edit-trigger').forEach(b => b.addEventListener('click', (e) => this.loadEdit(e.target.dataset.barcode)));
        tbody.querySelectorAll('.btn-delete-trigger').forEach(b => b.addEventListener('click', (e) => this.deleteProduct(e.target.dataset.barcode)));
    }

    loadEdit(barcode) {
        const item = this.cachedItems.find(i => i.barcode === barcode);
        if (!item) return;
        document.getElementById('product-id').value = item.barcode;
        document.getElementById('barcode').value = item.barcode;
        document.getElementById('barcode').disabled = true; 
        document.getElementById('name').value = item.name;
        document.getElementById('category').value = item.category;
        document.getElementById('price').value = item.price;
        document.getElementById('stock').value = item.stock;
        document.getElementById('min-stock').value = item.minStock;
        document.getElementById('form-title').textContent = 'Editar Artículo';
        document.getElementById('btn-cancel').style.display = 'inline-block';
    }

    async deleteProduct(barcode) {
        if (!confirm('¿Desea dar de baja este artículo?')) return;
        await this.inventory.removeItem(barcode);
        this.toast('Registro eliminado.');
        this.cachedItems = await this.inventory.fetchItems();
        this.renderInventoryTable();
    }

    renderCartView() {
        const tbody = document.getElementById('cart-table-body');
        tbody.innerHTML = this.sales.cart.map((item, idx) => `
            <tr>
                <td>${this.escape(item.name)}</td>
                <td>$${item.price.toFixed(2)}</td>
                <td><input type="number" value="${item.qty}" min="0" class="cart-qty-input" data-idx="${idx}" style="width:60px;"></td>
                <td>$${(item.price * item.qty).toFixed(2)}</td>
                <td><button class="btn btn-danger btn-action btn-remove-cart" data-idx="${idx}">❌</button></td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.cart-qty-input').forEach(i => i.addEventListener('change', (e) => {
            this.sales.updateQuantity(parseInt(e.target.dataset.idx), parseInt(e.target.value));
            this.renderCartView();
        }));
        tbody.querySelectorAll('.btn-remove-cart').forEach(b => b.addEventListener('click', (e) => {
            this.sales.updateQuantity(parseInt(e.target.dataset.idx), 0);
            this.renderCartView();
        }));

        document.getElementById('cart-grand-total').textContent = `$${this.sales.getCartTotal().toFixed(2)}`;
        this.calculateChange();
    }

    calculateChange() {
        const total = this.sales.getCartTotal();
        const cash = parseFloat(document.getElementById('cash-received').value) || 0;
        document.getElementById('cash-change').textContent = cash >= total ? `$${(cash - total).toFixed(2)}` : '$0.00';
    }

    async checkout() {
        if (!this.sales.cart.length) return this.toast('El ticket transaccional está vacío.', true);
        
        for (let item of this.sales.cart) {
            if (!item.isService) {
                const stockItem = this.cachedItems.find(i => i.barcode === item.barcode);
                if (stockItem) {
                    stockItem.stock = Math.max(0, stockItem.stock - item.qty);
                    await this.inventory.persistItem(stockItem);
                }
            }
        }

        await this.db.save('ventas', { date: new Date().toISOString(), total: this.sales.getCartTotal(), itemsCount: this.sales.cart.length });
        this.toast('Venta procesada e inventario sincronizado.');
        this.sales.clearCart();
        document.getElementById('cash-received').value = '';
        this.cachedItems = await this.inventory.fetchItems();
        this.renderCartView();
        this.renderInventoryTable();
    }

    async renderCorteCaja() {
        const ventas = await this.db.getAll('ventas');
        const gastos = await this.db.getAll('gastos');
        const hoy = new Date().toISOString().slice(0, 10);

        const vHoy = ventas.filter(v => v.date.startsWith(hoy));
        const gHoy = gastos.filter(g => g.date.startsWith(hoy));

        const inicial = parseFloat(localStorage.getItem('fondo_inicial_roger')) || 0;
        const ingresos = vHoy.reduce((acc, v) => acc + v.total, 0);
        const salidas = gHoy.reduce((acc, g) => acc + g.total, 0);

        document.getElementById('corte-inicial').textContent = `$${inicial.toFixed(2)}`;
        document.getElementById('corte-ingresos').textContent = `$${ingresos.toFixed(2)}`;
        document.getElementById('corte-gastos').textContent = `$${salidas.toFixed(2)}`;
        document.getElementById('corte-balance').textContent = `$${(inicial + ingresos - salidas).toFixed(2)}`;

        const tbody = document.getElementById('corte-table-body');
        let html = vHoy.map(v => `<tr>
            <td>${new Date(v.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
            <td style="color:var(--success);font-weight:bold;">VENTA</td>
            <td>${v.concept ? this.escape(v.concept) : `Nota de venta (${v.itemsCount} art.)`}</td>
            <td style="color:var(--success);">+$${v.total.toFixed(2)}</td>
            <td><button class="btn btn-danger btn-action btn-del-mov" data-store="ventas" data-id="${v.id}">❌</button></td>
        </tr>`).join('') + gHoy.map(g => `<tr>
            <td>${new Date(g.date).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</td>
            <td style="color:var(--danger);font-weight:bold;">GASTO</td>
            <td>${this.escape(g.description)}</td>
            <td style="color:var(--danger);">-$${g.total.toFixed(2)}</td>
            <td><button class="btn btn-danger btn-action btn-del-mov" data-store="gastos" data-id="${g.id}">❌</button></td>
        </tr>`).join('');

        tbody.innerHTML = html || '<tr><td colspan="5" style="text-align:center;">Sin flujo de caja hoy.</td></tr>';
        tbody.querySelectorAll('.btn-del-mov').forEach(b => b.addEventListener('click', async (e) => {
            if (!confirm('¿Eliminar movimiento del arqueo diario?')) return;
            const target = e.target.closest('.btn-del-mov');
            await this.db.delete(target.dataset.store, parseInt(target.dataset.id));
            this.renderCorteCaja();
        }));
    }

    async renderCreditsTable() {
        const list = await this.db.getAll('creditos');
        const tbody = document.getElementById('credit-table-body');
        if (!list.length) { tbody.innerHTML = '<tr><td colspan="4" style="text-align:center;">No hay cuentas pendientes 🎉</td></tr>'; return; }

        tbody.innerHTML = list.map(c => `<tr>
            <td><strong>${this.escape(c.name)}</strong></td>
            <td>${this.escape(c.description)}</td>
            <td style="color:var(--warning);font-weight:bold;">$${c.total.toFixed(2)}</td>
            <td>
                <button class="btn btn-success btn-action btn-pay-credit" data-id="${c.id}" data-name="${c.name}" data-total="${c.total}">✔ Liquidar</button>
                <button class="btn btn-danger btn-action btn-cancel-credit" data-id="${c.id}">❌</button>
            </td>
        </tr>`).join('');

        tbody.querySelectorAll('.btn-pay-credit').forEach(b => b.addEventListener('click', async (e) => {
            const target = e.target.closest('.btn-pay-credit');
            if(!confirm(`¿Liquidar saldo de ${target.dataset.name}?`)) return;
            await this.db.save('ventas', { date: new Date().toISOString(), total: parseFloat(target.dataset.total), concept: `Pago Fiado - ${target.dataset.name}`, itemsCount: 1 });
            await this.db.delete('creditos', parseInt(target.dataset.id));
            this.renderCreditsTable();
            this.toast('Saldo liquidado e ingresado a caja.');
        }));
        tbody.querySelectorAll('.btn-cancel-credit').forEach(b => b.addEventListener('click', async (e) => {
            if(!confirm('¿Anular esta cuenta corriente?')) return;
            await this.db.delete('creditos', parseInt(e.target.closest('.btn-cancel-credit').dataset.id));
            this.renderCreditsTable();
        }));
    }

    toast(msg, isError = false) {
        const el = document.getElementById('toast');
        el.textContent = msg;
        el.style.borderLeft = isError ? '4px solid var(--danger)' : '4px solid var(--success)';
        el.classList.add('show');
        setTimeout(() => el.classList.remove('show'), 3000);
    }

    escape(str) {
        return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[m]));
    }
}

// 4. MAIN APPLICATION ENTRY POINT (Arranque protegido de la App)
document.addEventListener('DOMContentLoaded', () => {
    const app = new AppEngine();
    app.bootstrap();
});