// Navegación entre secciones
function showSection(sectionId) {
    if (sectionId === 'company' && !isAdmin()) {
        showAlert('Solo administradores pueden entrar a Configuración', 'warning');
        return;
    }

    if (sectionId === 'accounting' && !isAdmin()) {
        showAlert('Solo administradores pueden entrar a Contabilidad', 'warning');
        return;
    }

    // Ocultar todas las secciones
    const sections = document.querySelectorAll('.section');
    sections.forEach(section => {
        section.style.display = 'none';
    });
    
    // Mostrar la sección seleccionada
    const section = document.getElementById(sectionId);
    if (section) {
        section.style.display = 'block';
        setActiveMenu(sectionId);
        
        // Cargar datos según la sección
        switch (sectionId) {
            case 'dashboard':
                loadDashboard();
                break;
            case 'products':
                loadProducts();
                break;
            case 'movements':
                loadMovements();
                break;
            case 'clients':
                loadClients();
                break;
            case 'cost-centers':
                loadCostCenters();
                break;
            case 'accounting':
                loadAccounting();
                break;
            case 'company':
                loadCompanyInfo();
                if (typeof loadCurrencySettings === 'function') {
                    loadCurrencySettings();
                }
                if (typeof loadUsers === 'function') {
                    loadUsers();
                }
                break;
        }
    }
    
    // Cerrar navbar en dispositivos móviles
    closeNavbar();
}

// Cargar dashboard
async function loadDashboard() {
    try {
        // Cargar estadísticas
        const [productsRes, movementsRes, lowStockRes] = await Promise.all([
            apiRequest('/products?limit=1'),
            apiRequest('/movements?limit=100'),
            apiRequest('/products/low-stock')
        ]);
        
        // Actualizar contadores
        document.getElementById('total-products').textContent = productsRes.meta.total;
        document.getElementById('low-stock').textContent = lowStockRes.length;
        
        // Calcular entradas y salidas de hoy
        const today = new Date().toISOString().split('T')[0];
        const todayMovements = movementsRes.data.filter(movement => 
            movement.date.startsWith(today)
        );
        
        const todayEntries = todayMovements.filter(m => m.type === 'ENTRADA').length;
        const todayExits = todayMovements.filter(m => m.type === 'SALIDA').length;
        
        document.getElementById('total-entries').textContent = todayEntries;
        document.getElementById('total-exits').textContent = todayExits;
        
        // Cargar movimientos recientes
        await loadRecentMovements();
        
        // Cargar productos bajo stock
        await loadLowStockProducts();
        
    } catch (error) {
        console.error('Error loading dashboard:', error);
    }
}

// Inicializar la aplicación
function initApp() {
    // Verificar autenticación
    checkAuth();
    
    // Auto-asignar data-section a enlaces del navbar que no lo tengan
    document.querySelectorAll('.nav-link').forEach(link => {
        if (!link.dataset.section) {
            const href = link.getAttribute('href') || '';
            if (href.includes('#')) {
                link.dataset.section = href.split('#').pop();
            } else {
                const text = (link.textContent || '').trim().toLowerCase();
                const known = {
                    'productos': 'products',
                    'dashboard': 'dashboard',
                    'movimientos': 'movements',
                    'clientes': 'clients',
                    'centro': 'cost-centers',
                    'contabilidad': 'accounting',
                    'empresa': 'company',
                    'administrativo': 'admin',
                    'admin': 'admin'
                };
                for (const [label, id] of Object.entries(known)) {
                    if (text.includes(label)) {
                        link.dataset.section = id;
                        break;
                    }
                }
            }
        }
    });

    // Validar que las secciones referenciadas existan en DOM
    if (typeof verifySectionsExist === 'function') {
        verifySectionsExist();
    }

    // Configurar navegación
    document.addEventListener('click', (e) => {
        if (document.body.classList.contains('navbar-open')) {
            const insideMenu = e.target.closest('#navbar-menu');
            const onToggle = e.target.closest('.navbar-toggle');
            if (!insideMenu && !onToggle) {
                closeNavbar();
            }
        }

        const link = e.target.closest('.nav-link, .navbar-brand-link');
        if (!link) return;

        e.preventDefault();
        const sectionId = link.dataset.section;
        if (sectionId) {
            showSection(sectionId);
        }
    });

    
    if (typeof initCompactListResponsive === 'function') {
        initCompactListResponsive();
    }

    // Mostrar dashboard por defecto
    if (getToken()) {
        showSection('dashboard');
    }
}

function showDashboard() {
    showSection('dashboard');
}

// Inicializar cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', initApp);
