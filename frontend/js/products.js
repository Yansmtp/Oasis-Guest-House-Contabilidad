let products = [];
let currentProductPage = 1;
let totalProductPages = 1;
let lowStockItemsCache = [];
let lowStockExpanded = false;
const ADD_NEW_UNIT_VALUE = '__ADD_NEW_UNIT__';
const CUSTOM_UNITS_STORAGE_KEY = 'inventory_custom_units';
const DEFAULT_UNIT_OPTIONS = [
    { value: 'UNIDAD', label: 'Unidad' },
    { value: 'KILOGRAMO', label: 'Kilogramo' },
    { value: 'GRAMO', label: 'Gramo' },
    { value: 'LIBRA', label: 'Libra' },
    { value: 'ONZA', label: 'Onza' },
    { value: 'LITRO', label: 'Litro' },
    { value: 'MILILITRO', label: 'Mililitro' },
    { value: 'GALON', label: 'Galon' },
    { value: 'CAJA', label: 'Caja' },
    { value: 'POMO', label: 'Pomo' },
    { value: 'PAR', label: 'Par' },
    { value: 'METRO', label: 'Metro' },
    { value: 'CENTIMETRO', label: 'Centimetro' }
];

function sanitizeUnitValue(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
}

function getCustomUnitOptions() {
    try {
        const raw = localStorage.getItem(CUSTOM_UNITS_STORAGE_KEY);
        const list = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(list)) return [];
        return list
            .map(v => sanitizeUnitValue(v))
            .filter(Boolean);
    } catch (error) {
        console.warn('No se pudo leer unidades personalizadas:', error);
        return [];
    }
}

function saveCustomUnitOptions(units) {
    const clean = Array.from(new Set((units || [])
        .map(v => sanitizeUnitValue(v))
        .filter(Boolean)));
    localStorage.setItem(CUSTOM_UNITS_STORAGE_KEY, JSON.stringify(clean));
}

function upsertUnitOption(selectEl, value, label = value) {
    if (!selectEl) return;
    const normalized = sanitizeUnitValue(value);
    if (!normalized) return;

    const exists = Array.from(selectEl.options).some(opt => opt.value === normalized);
    if (exists) return;

    const option = document.createElement('option');
    option.value = normalized;
    option.textContent = label;

    const addNewOption = Array.from(selectEl.options).find(opt => opt.value === ADD_NEW_UNIT_VALUE);
    if (addNewOption) {
        selectEl.insertBefore(option, addNewOption);
    } else {
        selectEl.appendChild(option);
    }
}

function populateUnitSelect(selectId, preferredValue = 'UNIDAD') {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;

    const currentValue = sanitizeUnitValue(preferredValue || selectEl.value || 'UNIDAD');
    selectEl.innerHTML = '';

    const customUnits = getCustomUnitOptions();

    DEFAULT_UNIT_OPTIONS.forEach(unit => {
        upsertUnitOption(selectEl, unit.value, unit.label);
    });

    customUnits.forEach(unit => {
        upsertUnitOption(selectEl, unit, unit);
    });

    const addOption = document.createElement('option');
    addOption.value = ADD_NEW_UNIT_VALUE;
    addOption.textContent = '+ Agregar nueva unidad';
    selectEl.appendChild(addOption);

    upsertUnitOption(selectEl, currentValue, currentValue);
    selectEl.value = currentValue || 'UNIDAD';
    selectEl.dataset.prevValue = selectEl.value;
}

function maybeAddCustomUnitFromSelect(selectEl) {
    if (!selectEl || selectEl.value !== ADD_NEW_UNIT_VALUE) return true;

    const newUnit = sanitizeUnitValue(prompt('Escribe la nueva unidad de medida:'));
    const previous = sanitizeUnitValue(selectEl.dataset.prevValue || 'UNIDAD') || 'UNIDAD';

    if (!newUnit) {
        selectEl.value = previous;
        return false;
    }

    const customUnits = getCustomUnitOptions();
    if (!customUnits.includes(newUnit)) {
        customUnits.push(newUnit);
        saveCustomUnitOptions(customUnits);
    }

    ['product-unit', 'quick-product-unit'].forEach(id => populateUnitSelect(id, newUnit));
    selectEl.value = newUnit;
    selectEl.dataset.prevValue = newUnit;
    return true;
}

function setupUnitSelectBehavior(selectId, preferredValue = 'UNIDAD') {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return;

    populateUnitSelect(selectId, preferredValue);

    if (!selectEl.dataset.unitEventsBound) {
        selectEl.addEventListener('focus', () => {
            selectEl.dataset.prevValue = selectEl.value;
        });
        selectEl.addEventListener('change', () => {
            maybeAddCustomUnitFromSelect(selectEl);
            selectEl.dataset.prevValue = selectEl.value;
        });
        selectEl.dataset.unitEventsBound = '1';
    }
}

function refreshAllUnitSelects(preferredValue = 'UNIDAD') {
    ['product-unit', 'quick-product-unit'].forEach(id => populateUnitSelect(id, preferredValue));
}

function removeCustomUnit(unit) {
    const cleanUnit = sanitizeUnitValue(unit);
    const updated = getCustomUnitOptions().filter(u => u !== cleanUnit);
    saveCustomUnitOptions(updated);

    const selects = ['product-unit', 'quick-product-unit'];
    selects.forEach(id => {
        const select = document.getElementById(id);
        const prev = select ? sanitizeUnitValue(select.value) : 'UNIDAD';
        const nextValue = prev === cleanUnit ? 'UNIDAD' : prev;
        populateUnitSelect(id, nextValue);
    });

    renderUnitManagerList();
}

function addCustomUnitViaManager() {
    const newUnit = sanitizeUnitValue(prompt('Escribe la nueva unidad de medida:'));
    if (!newUnit) return;
    const customUnits = getCustomUnitOptions();
    if (!customUnits.includes(newUnit)) {
        customUnits.push(newUnit);
        saveCustomUnitOptions(customUnits);
    }
    refreshAllUnitSelects(newUnit);
    renderUnitManagerList();
}

function openUnitManager() {
    renderUnitManagerList();
    showModal('unit-manager-modal');
}

function renderUnitManagerList() {
    const listEl = document.getElementById('unit-manager-list');
    if (!listEl) return;

    const customUnits = getCustomUnitOptions();
    const defaultUnits = DEFAULT_UNIT_OPTIONS.map(u => u.value);
    const allUnits = Array.from(new Set([...defaultUnits, ...customUnits])).sort();

    listEl.innerHTML = '';

    if (!allUnits.length) {
        listEl.innerHTML = '<p class="text-muted mb-0">Aún no hay unidades registradas.</p>';
        return;
    }

    allUnits.forEach(unitValue => {
        const isDefault = defaultUnits.includes(unitValue);

        const row = document.createElement('div');
        row.className = 'unit-manager-row';

        const label = document.createElement('div');
        label.className = 'unit-label';
        label.innerHTML = `
            <strong>${formatUnit(unitValue)}</strong>
            <small class="text-muted d-block">${unitValue}</small>
        `;

        const actions = document.createElement('div');
        actions.className = 'unit-actions';

        if (isDefault) {
            const badge = document.createElement('span');
            badge.className = 'badge badge-secondary';
            badge.textContent = 'Predeterminada';
            actions.appendChild(badge);
        } else {
            const btn = document.createElement('button');
            btn.className = 'btn btn-sm btn-outline-danger';
            btn.textContent = 'Eliminar';
            btn.addEventListener('click', () => removeCustomUnit(unitValue));
            actions.appendChild(btn);
        }

        row.appendChild(label);
        row.appendChild(actions);
        listEl.appendChild(row);
    });
}

function getUnitValueFromSelect(selectId) {
    const selectEl = document.getElementById(selectId);
    if (!selectEl) return 'UNIDAD';
    maybeAddCustomUnitFromSelect(selectEl);
    return sanitizeUnitValue(selectEl.value || 'UNIDAD') || 'UNIDAD';
}

function syncDashboardPanelHeights() {
    const leftCard = document.getElementById('recent-movements-card');
    const rightCard = document.getElementById('low-stock-card');
    if (!leftCard || !rightCard) return;
    rightCard.style.minHeight = '';
    const leftHeight = leftCard.offsetHeight || 0;
    if (leftHeight > 0) {
        rightCard.style.minHeight = `${leftHeight}px`;
    }
}

function renderLowStockList() {
    const container = document.getElementById('low-stock-list');
    const toggleBtn = document.getElementById('low-stock-toggle-btn');
    if (!container) return;

    container.innerHTML = '';

    if (!lowStockItemsCache.length) {
        container.innerHTML = '<p class="text-center text-muted">No hay productos bajo stock</p>';
        if (toggleBtn) toggleBtn.style.display = 'none';
        syncDashboardPanelHeights();
        return;
    }

    const maxCollapsedItems = 5;
    const itemsToShow = lowStockExpanded ? lowStockItemsCache : lowStockItemsCache.slice(0, maxCollapsedItems);

    itemsToShow.forEach(product => {
        const item = document.createElement('div');
        item.className = 'low-stock-item';
        item.innerHTML = `
            <div class="low-stock-item-main">
                <strong>${product.name}</strong><br>
                <small>Código: ${product.code}</small>
            </div>
            <div class="text-right low-stock-item-qty">
                <span class="text-danger">${formatNumber(product.stock)} ${formatUnit(product.unit)}</span><br>
                <small>Mínimo: ${formatNumber(product.minStock)}</small>
            </div>
        `;
        container.appendChild(item);
    });

    if (toggleBtn) {
        const hasMore = lowStockItemsCache.length > maxCollapsedItems;
        toggleBtn.style.display = hasMore ? 'inline-flex' : 'none';
        toggleBtn.textContent = lowStockExpanded ? 'Mostrar menos' : 'Mostrar más';
    }

    syncDashboardPanelHeights();
}

function generateProductCodeFallback() {
    const yy = String(new Date().getFullYear()).slice(-2);
    const rand = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    return `PRD${yy}${rand}`;
}

async function getNextProductCode() {
    try {
        const response = await apiRequest('/products/next-code');
        return response?.code || generateProductCodeFallback();
    } catch (error) {
        console.warn('No se pudo obtener el siguiente codigo de producto:', error);
        return generateProductCodeFallback();
    }
}

// Fallback in case utils.js did not attach parseNumberSafe yet.
var parseNumberSafe = window.parseNumberSafe || function (value) {
    if (value == null) return 0;
    if (typeof value === 'number') return value;
    if (typeof value === 'object' && typeof value.toNumber === 'function') {
        try { return value.toNumber(); } catch (e) { /* noop */ }
    }
    let s = String(value).trim();
    s = s.replace(/[^0-9\-.,]/g, '');
    if (s.indexOf('.') !== -1 && s.indexOf(',') !== -1) {
        s = s.replace(/\\./g, '').replace(',', '.');
    } else if (s.indexOf(',') !== -1 && s.indexOf('.') === -1) {
        s = s.replace(',', '.');
    }
    const n = parseFloat(s);
    return isNaN(n) ? 0 : n;
};

// Cargar productos
async function loadProducts(page = 1, search = '', filter = 'all') {
    try {
        showLoading('products-table');
        
        const response = await apiRequest(`/products?page=${page}&limit=10&search=${search}`);
        
        products = response.data;
        currentProductPage = response.meta.page;
        totalProductPages = response.meta.totalPages;
        
        renderProductsTable();
        createPagination('products-pagination', currentProductPage, totalProductPages, loadProducts);
        
    } catch (error) {
        console.error('Error loading products:', error);
    } finally {
        hideLoading();
    }
}

// Renderizar tabla de productos
function renderProductsTable() {
    const tbody = document.getElementById('products-table').querySelector('tbody');
    tbody.innerHTML = '';
    
    if (products.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="9" class="text-center">
                No se encontraron productos
            </td>
        `;
        tbody.appendChild(row);
        return;
    }
    
    const compact = typeof isCompactListView === 'function' && isCompactListView();

    products.forEach(product => {
        const row = document.createElement('tr');
        const canDelete = isAdmin();
        const stock = parseNumberSafe(product.stock);
        const minStock = parseNumberSafe(product.minStock);
        const isLowStock = stock <= minStock;

        if (compact) {
            row.className = 'table-compact-row' + (isLowStock ? ' table-danger' : '');
            row.innerHTML = `<td colspan="9" class="table-compact-cell">${buildProductListItemHtml(product, { canDelete })}</td>`;
        } else {
            const unitCost = parseNumberSafe(product.unitCost);
            const totalValue = stock * unitCost;
            row.innerHTML = `
                <td class="cell-compact">${product.code}</td>
                <td class="cell-text">
                    <strong>${product.name}</strong>
                    ${product.description ? `<small class="text-muted">${product.description}</small>` : ''}
                </td>
                <td class="cell-compact">${formatUnit(product.unit)}</td>
                <td class="cell-numeric text-right">
                    ${formatNumber(stock)}
                    ${isLowStock ? '<i class="fas fa-exclamation-triangle text-danger ml-1"></i>' : ''}
                </td>
                <td class="cell-numeric text-right">${formatNumber(minStock)}</td>
                <td class="cell-currency text-right">${formatCurrency(unitCost)}</td>
                <td class="cell-currency text-right">${formatCurrency(totalValue)}</td>
                <td class="cell-compact">
                    <span class="status-badge ${product.isActive ? 'status-active' : 'status-inactive'}">
                        ${product.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td class="actions">
                    <button class="btn btn-sm btn-outline" onclick="editProduct(${product.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${canDelete ? `
                    <button class="btn btn-sm btn-outline" onclick="deleteProduct(${product.id})" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>` : ''}
                    <button class="btn btn-sm btn-outline" onclick="viewProductHistory(${product.id})" title="Historial">
                        <i class="fas fa-history"></i>
                    </button>
                </td>
            `;
            if (isLowStock) row.classList.add('table-danger');
        }

        tbody.appendChild(row);
    });
}

// Formatear unidad
function formatUnit(unit) {
    const normalized = sanitizeUnitValue(unit).toUpperCase();
    const units = {
        'UNIDAD': 'Unidad',
        'KILOGRAMO': 'Kg',
        'GRAMO': 'g',
        'LIBRA': 'lb',
        'ONZA': 'oz',
        'LITRO': 'L',
        'MILILITRO': 'mL',
        'GALON': 'gal',
        'CAJA': 'Caja',
        'POMO': 'Pomo',
        'PAR': 'Par',
        'METRO': 'm',
        'CENTIMETRO': 'cm'
    };
    return units[normalized] || sanitizeUnitValue(unit);
}

// Buscar productos
function searchProducts() {
    const search = document.getElementById('product-search').value;
    loadProducts(1, search);
}

// Filtrar productos
function filterProducts() {
    const filter = document.getElementById('product-filter').value;
    // Implementar filtrado según necesidad
    console.log('Filter:', filter);
}

// Mostrar modal para agregar producto
async function showAddProductModal() {
    resetForm('product-form');
    document.getElementById('product-modal-title').textContent = 'Nuevo Producto';
    document.getElementById('product-id').value = '';
    document.getElementById('product-code').value = await getNextProductCode();
    setupUnitSelectBehavior('product-unit', 'UNIDAD');
    showModal('product-modal');
}

// Editar producto
async function editProduct(id) {
    try {
        const product = await apiRequest(`/products/${id}`);
        
        document.getElementById('product-modal-title').textContent = 'Editar Producto';
        document.getElementById('product-id').value = product.id;
        document.getElementById('product-code').value = product.code;
        document.getElementById('product-name').value = product.name;
        document.getElementById('product-description').value = product.description || '';
        setupUnitSelectBehavior('product-unit', product.unit || 'UNIDAD');
        document.getElementById('product-min-stock').value = product.minStock;
        document.getElementById('product-max-stock').value = product.maxStock || '';
        document.getElementById('product-active').checked = product.isActive;
        
        showModal('product-modal');
    } catch (error) {
        showAlert('Error al cargar el producto', 'error');
    }
}

// Guardar producto
async function saveProduct() {
    if (!validateForm('product-form')) {
        showAlert('Por favor, complete los campos requeridos', 'warning');
        return;
    }
    
    const productData = {
        code: document.getElementById('product-code').value,
        name: document.getElementById('product-name').value,
        description: document.getElementById('product-description').value,
        unit: getUnitValueFromSelect('product-unit'),
        minStock: parseFloat(document.getElementById('product-min-stock').value),
        isActive: document.getElementById('product-active').checked
    };
    
    const maxStock = document.getElementById('product-max-stock').value;
    if (maxStock) {
        productData.maxStock = parseFloat(maxStock);
    }
    
    const productId = document.getElementById('product-id').value;
    
    try {
        if (productId) {
            // Actualizar producto existente
            await apiRequest(`/products/${productId}`, {
                method: 'PATCH',
                body: JSON.stringify(productData)
            });
            showAlert('Producto actualizado exitosamente', 'success');
        } else {
            // Crear nuevo producto
            await apiRequest('/products', {
                method: 'POST',
                body: JSON.stringify(productData)
            });
            showAlert('Producto creado exitosamente', 'success');
        }
        
        closeModal();
        loadProducts(currentProductPage);
        
    } catch (error) {
        showAlert(error.message || 'Error al guardar el producto', 'error');
    }
}

// Eliminar producto (desactivar)
async function deleteProduct(id) {
    if (!confirm('¿Está seguro de que desea desactivar este producto?')) {
        return;
    }
    
    try {
        await apiRequest(`/products/${id}`, {
            method: 'DELETE'
        });
        
        showAlert('Producto desactivado exitosamente', 'success');
        loadProducts(currentProductPage);
        
    } catch (error) {
        showAlert(error.message || 'Error al desactivar el producto', 'error');
    }
}

// Ver historial del producto
async function viewProductHistory(id) {
    try {
        // Implementar vista de historial
        showAlert('Funcionalidad en desarrollo', 'info');
    } catch (error) {
        showAlert('Error al cargar el historial', 'error');
    }
}


// Cargar productos bajo stock para el dashboard
async function loadLowStockProducts() {
    try {
        const response = await apiRequest('/products/low-stock');
        lowStockItemsCache = Array.isArray(response) ? response : [];
        lowStockExpanded = false;
        renderLowStockList();
    } catch (error) {
        console.error('Error loading low stock products:', error);
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    setupUnitSelectBehavior('product-unit', 'UNIDAD');
    setupUnitSelectBehavior('quick-product-unit', 'UNIDAD');

    if (document.getElementById('products-table')) {
        loadProducts();
    }

    const lowStockToggleBtn = document.getElementById('low-stock-toggle-btn');
    if (lowStockToggleBtn) {
        lowStockToggleBtn.addEventListener('click', () => {
            lowStockExpanded = !lowStockExpanded;
            renderLowStockList();
        });
    }

    window.addEventListener('resize', () => {
        syncDashboardPanelHeights();
    });
});

window.formatUnit = formatUnit;
window.setupUnitSelectBehavior = setupUnitSelectBehavior;
window.getUnitValueFromSelect = getUnitValueFromSelect;
window.openUnitManager = openUnitManager;
window.addCustomUnitViaManager = addCustomUnitViaManager;
