/**
 * Papelería Roger - Advanced Corporate Architecture Engine (Supabase Cloud Version)
 */

// 1. DATA ACCESS LAYER (Conexión Directa a la Nube)
const SUPABASE_URL = "https://oxrzpgeifttrzznxxmjl.supabase.co"; 
const SUPABASE_ANON_KEY = "sb_publishable_tCQX-_fg3E7YBvOOZK3jgA_ynKHe-SR"; 

// Inicializar cliente global utilizando la librería cargada desde el CDN del HTML
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

class DatabaseService {
    constructor() {
        this.db = supabaseClient;
    }

    async connect() {
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
        
        return data.map(row => ({
            barcode: row.id ? row.id.toString() : Date.now().toString(),
            name: row.nombre || '',
            category: row.categoria || 'Otros',
            price: parseFloat(row.precio) || 0,
            stock: parseInt(row.cantidad, 10) || 0,
            minStock: parseInt(row.min_stock, 10) || 5 
        }));
    }

    async saveItem(item) {
        const dbRow = {
            nombre: item.name,
            precio: item.price,
            cantidad: item.stock,
            categoria: item.category
        };

        try {
            if (item.barcode && !item.barcode.startsWith('ART-') && !isNaN(item.barcode)) {
                const { error } = await this.db
                    .from('inventario')
                    .update(dbRow)
                    .eq('id', parseInt(item.barcode, 10));
                if (error) throw error;
                alert("📝 ¡Artículo editado correctamente!");
            } else {
                const { error } = await this.db
                    .from('inventario')
                    .insert([dbRow]);
                if (error) throw error;
                alert("✨ ¡Artículo nuevo guardado en la nube!");
            }
        } catch (err) {
            console.error("Error en Supabase:", err);
            alert(`❌ ERROR: ${err.message || 'No se pudo guardar. Verifica tus políticas RLS en Supabase.'}`);
        }
    }

    async deleteItem(id) {
        try {
            const { error } = await this.db
                .from('inventario')
                .delete()
                .eq('id', parseInt(id, 10));
            if (error) throw error;
            alert("🗑️ Artículo eliminado.");
        } catch (err) {
            console.error("Error al eliminar:", err);
            alert(`❌ ERROR AL ELIMINAR: ${err.message}`);
        }
    }

    // --- MANTENIMIENTO LOCAL (Caja y Fiados) ---
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

// 2. CORE DOMAIN SERVICES
class InventoryService {
    constructor(dbService) { this.db = dbService; }
    async fetchItems() { return await this.db.getAllItems(); }
    async persistItem(item) { await this.db.saveItem(item); }
    async removeItem(barcode) { await this.db.deleteItem(barcode); }
}

class SalesService {
    constructor(dbService) { this.db = dbService; this.cart = []; }
    clearCart() { this.cart = []; }
    addService(description, price) { this.cart.push({ barcode: `SRV-${Date.now()}`, name: description, price: parseFloat(price), qty: 1, isService: true }); }
    addProduct(product) {
        const itemInCart = this.cart.find(c => c.barcode === product.barcode);
        if (itemInCart) itemInCart.qty++; else this.cart.push({ barcode: product.barcode, name: product.name, price: product.price, qty: 1, isService: false });
    }
    updateQuantity(index, qty) { if (qty <= 0) this.cart.splice(index, 1); else this.cart[index].qty = qty; }
    getCartTotal() { return this.cart.reduce((acc, i) => acc + (i.price * i.qty), 0); }
}

// 3. APPLICATION ORCHESTRATOR
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
        } catch (error) { this.toast('Error crítico al conectar.', true); }
    }

    bindEvents() {
        document.getElementById('main-nav-tabs').addEventListener('click', (e) => {
            const btn = e.target.closest('.tab-btn');
            if (!btn) return;
            document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.getElementById(btn.dataset.tab).classList.add('active');
            btn.classList.add('active');
            if (btn.dataset.tab === 'tab-caja') { this.renderCorteCaja(); this.renderCreditsTable(); }
        });

        document.getElementById('product-form').addEventListener('submit', async (e) => {
            e.preventDefault();
            const item = {
                barcode: document.getElementById('product-id').value || '',
                name: document.getElementById('name').value.trim(),
                category: document.getElementById('category').value,
                price: parseFloat(document.getElementById('price').value),
                stock: parseInt(document.getElementById('stock').value, 10),
                minStock: parseInt(document.getElementById('min-stock').value, 10)
            };
            await this.inventory.persistItem(item);
            e.target.reset();
            document.getElementById('product-id').value = '';
            this.cachedItems = await this.inventory.fetchItems();
            this.renderInventoryTable();
        });
        
        // ... (El resto de tus eventos siguen igual)
        document.getElementById('search-input').addEventListener('input', () => this.renderInventoryTable());
        document.getElementById('filter-stock').addEventListener('change', () => this.renderInventoryTable());
    }

    renderInventoryTable() {
        const tbody = document.getElementById('inventory-table-body');
        tbody.innerHTML = this.cachedItems.map(item => `
            <tr>
                <td><code>ID-${this.escape(item.barcode)}</code></td>
                <td><strong>${this.escape(item.name)}</strong></td>
                <td>${this.escape(item.category)}</td>
                <td>$${item.price.toFixed(2)}</td>
                <td>${item.stock}</td>
                <td class="actions">
                    <button class="btn btn-action btn-edit-trigger" data-barcode="${item.barcode}">Editar</button>
                    <button class="btn btn-danger btn-action btn-delete-trigger" data-barcode="${item.barcode}">Eliminar</button>
                </td>
            </tr>
        `).join('');
        
        tbody.querySelectorAll('.btn-delete-trigger').forEach(b => b.addEventListener('click', async (e) => {
            await this.inventory.removeItem(e.target.dataset.barcode);
            this.cachedItems = await this.inventory.fetchItems();
            this.renderInventoryTable();
        }));
    }

    // Funciones de apoyo
    escape(str) { return String(str).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }[m])); }
    toast(msg, isError = false) { /* ... tu lógica de toast ... */ }
    renderCartView() { /* ... tu lógica de ventas ... */ }
    renderCorteCaja() { /* ... tu lógica de corte ... */ }
    renderCreditsTable() { /* ... tu lógica de fiado ... */ }
    calculateChange() { /* ... tu lógica de cambio ... */ }
    checkout() { /* ... tu lógica de checkout ... */ }
}

document.addEventListener('DOMContentLoaded', () => { new AppEngine().bootstrap(); });