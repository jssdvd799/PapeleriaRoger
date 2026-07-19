/**
 * Papelería Roger - Advanced Corporate Architecture Engine (Supabase Cloud Version)
 */

// 1. DATA ACCESS LAYER (Conexión Directa a la Nube)
// Pon tus llaves de conexión obtenidas en el panel aquí:
const SUPABASE_URL = "https://oxrzpgeifttrzznxxmjl.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_tCQX-_fg3E7YBvOOZK3jgA_ynKHe-SR"; 

import { createClient } from '@supabase/supabase-js'
const supabaseUrl = 'https://oxrzpgeifttrzznxxmjl.supabase.co'
const supabaseKey = process.env.SUPABASE_KEY
const supabase = createClient(supabaseUrl, supabaseKey)

// Inicializar cliente global de Supabase (requiere el script en tu HTML)
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class DatabaseService {
    constructor() {
        // Mantenemos la estructura para no romper la compatibilidad con las otras capas
        this.db = supabaseClient;
    }

    async connect() {
        // En Supabase la conexión es HTTP directa, así que verificamos acceso básico
        try {
            const { data, error } = await this.db.from('inventario').select('count', { count: 'exact', head: true });
            if (error) throw error;
            console.log("🚀 Sincronización exitosa con el servidor en la nube de Supabase.");
            return true;
        } catch (err) {
            console.error("Fallo de conexión a la API de Supabase:", err);
            throw new Error('Error al conectar con el servidor en la nube.');
        }
    }

    // Métodos específicos para la tabla 'inventario' vinculada a Supabase
    async getAllItems() {
        const { data, error } = await this.db
            .from('inventario')
            .select('*')
            .order('nombre', { ascending: true });
        
        if (error) { console.error(error); return []; }
        
        // Mapeamos los nombres de columnas de Supabase a los objetos de tu UI
        return data.map(row => ({
            barcode: row.id.toString(), // Usamos el ID de la base de datos como código
            name: row.nombre,
            category: "Papelería", // Valor por defecto
            price: parseFloat(row.precio),
            stock: parseInt(row.cantidad, 10),
            minStock: 5 // Control interno local
        }));
    }

    async saveItem(item) {
        // Estructuramos el objeto tal cual lo pide la tabla en Supabase
        const dbRow = {
            nombre: item.name,
            precio: item.price,
            cantidad: item.stock
        };

        // Si el código es numérico, significa que estamos editando una fila existente
        if (item.barcode && !item.barcode.startsWith('ART-') && !isNaN(item.barcode)) {
            const { error } = await this.db
                .from('inventario')
                .update(dbRow)
                .eq('id', parseInt(item.barcode, 10));
            if (error) console.error("Error al actualizar en la nube:", error);
        } else {
            // Si es un artículo nuevo, lo insertamos y dejamos que el ID sea autoincrementable
            const { error } = await this.db
                .from('inventario')
                .insert([dbRow]);
            if (error) console.error("Error al insertar en la nube:", error);
        }
    }

    async deleteItem(id) {
        const { error } = await this.db
            .from('inventario')
            .delete()
            .eq('id', parseInt(id, 10));
        if (error) console.error("Error al eliminar de la nube:", error);
    }

    // --- MANTENIMIENTO LOCAL MEDIANTE LOCALSTORAGE PARA FLUJO DE CAJA Y FIADOS ---
    // (Para no alterar las otras tablas de gastos/créditos locales por ahora)
    async getAll(storeName) {
        return JSON.parse(localStorage.getItem(`roger_local_${storeName}`)) || [];
    }

    async save(storeName, item) {
        const list = await this.getAll(storeName);
        if (!item.id) item.id = Date.now();
        const index = list.findIndex(i => i.id === item.id);
        if (index > -1) list[index] = item; else list.push(item);
        localStorage.setItem(`roger_local_${storeName}`, JSON.stringify(list));
    }

    async delete(storeName, key) {
        let list = await this.getAll(storeName);
        list = list.filter(i => i.id !== key);
        localStorage.setItem(`roger_local_${storeName}`, JSON.stringify(list));
    }
}

// 2. CORE DOMAIN BUSINESS SERVICES (Reglas de Negocio Adaptadas)
class InventoryService {
    constructor(dbService) {
        this.db = dbService;
    }

    async fetchItems() {
        return await this.db.getAllItems();
    }

    async persistItem(item) {
        await this.db.saveItem(item);
    }

    async removeItem(barcode) {
        await this.db.deleteItem(barcode);
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
        this.db = new DatabaseService();
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
            this.toast('Error crítico al conectar a la nube.', true);
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

            let barcode = document.getElementById('product-id').value || '';
            const item = {
                barcode,
                name: document.getElementById('name').value.trim(),
                category: document.getElementById('category').value,
                price: parseFloat(document.getElementById('price').value),
                stock: parseInt(document.getElementById('stock').value, 10),
                minStock: parseInt(document.getElementById('min-stock').value, 10)
            };
            await this.inventory.persistItem(item);
            this.toast('Artículo guardado exitosamente en la nube.');
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

        // Import / Export Lógica Local Reutilizada
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
                    for (const item of items) { await this.inventory.persistItem(item); }
                    this.toast('Ecosistema restaurado e inyectado a la nube.');
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
                <td><code>ID-${this.escape(item.barcode)}</code></td>
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

        tbody.querySelectorAll('.btn-edit-trigger').forEach(b => b.addEventListener('click', (e) => this.loadEdit(e.target.dataset.barcode)));
        tbody.querySelectorAll('.btn-delete-trigger').forEach(b => b.addEventListener('click', (e) => this.deleteProduct(e.target.dataset.barcode)));
    }

    loadEdit(barcode) {
        const item = this.cachedItems.find(i => i.barcode === barcode);
        if (!item) return;
        document.getElementById('product-id').value = item.barcode; // Guardamos el ID real de Supabase
        document.getElementById('barcode').value = `ID-${item.barcode}`;
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
        if (!confirm('¿Desea dar de baja este artículo en la nube?')) return;
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
                    await this.inventory.persistItem(stockItem); // Actualiza stock directo en Supabase
                }
            }
        }

        await this.db.save('ventas', { date: new Date().toISOString(), total: this.sales.getCartTotal(), itemsCount: this.sales.cart.length });
        this.toast('Venta procesada e inventario sincronizado en la nube.');
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
        if(!el) return alert(msg); // Fallback por si no encuentra el contenedor en el DOM
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