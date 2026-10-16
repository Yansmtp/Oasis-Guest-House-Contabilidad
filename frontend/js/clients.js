let clients = [];
let currentClientPage = 1;
let totalClientPages = 1;

function generateAutoCode(prefix) {
    return `${prefix}${Date.now().toString().slice(-8)}`;
}

// Cargar clientes
async function loadClients(page = 1, search = '') {
    try {
        showLoading('clients-table');
        
        const response = await apiRequest(`/clients?page=${page}&limit=10&search=${search}`);
        
        clients = response.data;
        currentClientPage = response.meta.page;
        totalClientPages = response.meta.totalPages;
        
        renderClientsTable();
        createPagination('clients-pagination', currentClientPage, totalClientPages, 
            (newPage) => loadClients(newPage, search));
        
    } catch (error) {
        console.error('Error loading clients:', error);
    } finally {
        hideLoading();
    }
}

// Renderizar tabla de clientes
function renderClientsTable() {
    const tbody = document.getElementById('clients-table').querySelector('tbody');
    tbody.innerHTML = '';
    
    if (clients.length === 0) {
        const row = document.createElement('tr');
        row.innerHTML = `
            <td colspan="7" class="text-center">
                No se encontraron clientes
            </td>
        `;
        tbody.appendChild(row);
        return;
    }
    
    const compact = typeof isCompactListView === 'function' && isCompactListView();

    clients.forEach(client => {
        const row = document.createElement('tr');
        const canDelete = isAdmin();

        if (compact) {
            row.className = 'table-compact-row';
            row.innerHTML = `<td colspan="7" class="table-compact-cell">${buildClientListItemHtml(client, { canDelete })}</td>`;
        } else {
            row.innerHTML = `
                <td class="cell-compact">${client.code}</td>
                <td class="cell-text">
                    <strong>${client.name}</strong>
                    ${client.address ? `<small>${client.address}</small>` : ''}
                </td>
                <td class="cell-text">${client.email || '-'}</td>
                <td class="cell-text">${client.phone || '-'}</td>
                <td class="cell-compact">${client.taxId || '-'}</td>
                <td class="cell-compact">
                    <span class="status-badge ${client.isActive ? 'status-active' : 'status-inactive'}">
                        ${client.isActive ? 'Activo' : 'Inactivo'}
                    </span>
                </td>
                <td class="actions">
                    <button class="btn btn-sm btn-outline" onclick="editClient(${client.id})" title="Editar">
                        <i class="fas fa-edit"></i>
                    </button>
                    ${canDelete ? `
                    <button class="btn btn-sm btn-outline" onclick="deleteClient(${client.id})" title="Eliminar">
                        <i class="fas fa-trash"></i>
                    </button>` : ''}
                    <button class="btn btn-sm btn-outline" onclick="viewClientMovements(${client.id})" title="Movimientos">
                        <i class="fas fa-exchange-alt"></i>
                    </button>
                </td>
            `;
        }

        tbody.appendChild(row);
    });
}

// Buscar clientes
function searchClients() {
    const search = document.getElementById('client-search').value;
    loadClients(1, search);
}

// Mostrar modal para agregar cliente
function showAddClientModal() {
    resetForm('client-form');
    document.getElementById('client-modal-title').textContent = 'Nuevo Cliente';
    document.getElementById('client-id').value = '';
    document.getElementById('client-code').value = generateAutoCode('CLI-');
    showModal('client-modal');
}

// Editar cliente
async function editClient(id) {
    try {
        const client = await apiRequest(`/clients/${id}`);
        
        document.getElementById('client-modal-title').textContent = 'Editar Cliente';
        document.getElementById('client-id').value = client.id;
        document.getElementById('client-code').value = client.code;
        document.getElementById('client-name').value = client.name;
        document.getElementById('client-email').value = client.email || '';
        document.getElementById('client-phone').value = client.phone || '';
        document.getElementById('client-address').value = client.address || '';
        document.getElementById('client-tax-id').value = client.taxId || '';
        document.getElementById('client-active').checked = client.isActive;
        
        showModal('client-modal');
    } catch (error) {
        showAlert('Error al cargar el cliente', 'error');
    }
}

// Guardar cliente
async function saveClient() {
    if (!validateForm('client-form')) {
        showAlert('Por favor, complete los campos requeridos', 'warning');
        return;
    }
    
    const clientData = {
        code: document.getElementById('client-code').value,
        name: document.getElementById('client-name').value,
        email: document.getElementById('client-email').value || undefined,
        phone: document.getElementById('client-phone').value || undefined,
        address: document.getElementById('client-address').value || undefined,
        taxId: document.getElementById('client-tax-id').value || undefined,
        isActive: document.getElementById('client-active').checked
    };
    
    const clientId = document.getElementById('client-id').value;
    
    try {
        if (clientId) {
            // Actualizar cliente existente
            await apiRequest(`/clients/${clientId}`, {
                method: 'PATCH',
                body: JSON.stringify(clientData)
            });
            showAlert('Cliente actualizado exitosamente', 'success');
        } else {
            // Crear nuevo cliente
            await apiRequest('/clients', {
                method: 'POST',
                body: JSON.stringify(clientData)
            });
            showAlert('Cliente creado exitosamente', 'success');
        }
        
        closeModal();
        loadClients(currentClientPage);
        
    } catch (error) {
        showAlert(error.message || 'Error al guardar el cliente', 'error');
    }
}

// Eliminar cliente (desactivar)
async function deleteClient(id) {
    if (!confirm('¿Está seguro de que desea desactivar este cliente?')) {
        return;
    }
    
    try {
        await apiRequest(`/clients/${id}`, {
            method: 'DELETE'
        });
        
        showAlert('Cliente desactivado exitosamente', 'success');
        loadClients(currentClientPage);
        
    } catch (error) {
        showAlert(error.message || 'Error al desactivar el cliente', 'error');
    }
}

// Ver movimientos del cliente
async function viewClientMovements(id) {
    try {
        const client = await apiRequest(`/clients/${id}`);
        const movements = await apiRequest(`/clients/${id}/movements`);
        const bodyEl = document.getElementById('client-detail-body');
        const titleEl = document.getElementById('client-detail-title');
        const subtitleEl = document.getElementById('client-detail-subtitle');
        const badgeEl = document.getElementById('client-detail-status-badge');

        if (titleEl) {
            titleEl.textContent = `Cliente: ${client.name || client.code || '—'}`;
        }
        if (subtitleEl) {
            subtitleEl.textContent = `Código: ${client.code || '—'}`;
        }
        if (badgeEl) {
            badgeEl.textContent = client.isActive ? 'Activo' : 'Inactivo';
            badgeEl.className = `status-badge ${client.isActive ? 'status-active' : 'status-inactive'}`;
        }

        if (bodyEl) {
            const movementRows = movements.length
                ? movements.slice(0, 8).map(movement => {
                    const totalAmount = (movement.details || []).reduce(
                        (sum, detail) => sum + Number(detail.totalCost || 0),
                        0,
                    );
                    return `
                        <tr>
                            <td class="cell-compact">${escapeHtml(movement.documentNumber || movement.id || '')}</td>
                            <td class="cell-text">${escapeHtml(formatDate(movement.date))}</td>
                            <td class="cell-text">${escapeHtml(movement.type === 'ENTRADA' ? 'Entrada' : 'Salida')}</td>
                            <td class="cell-currency text-right">${formatCurrency(totalAmount, movement.currencyCode || 'USD')}</td>
                            <td class="cell-text">${escapeHtml(movement.user?.name || '—')}</td>
                        </tr>
                    `;
                }).join('')
                : '';

            bodyEl.innerHTML = `
                <div class="movement-detail-meta">
                    <div class="movement-detail-meta-item">
                        <label>Email</label>
                        <span>${escapeHtml(client.email || '—')}</span>
                    </div>
                    <div class="movement-detail-meta-item">
                        <label>Teléfono</label>
                        <span>${escapeHtml(client.phone || '—')}</span>
                    </div>
                    <div class="movement-detail-meta-item">
                        <label>Dirección</label>
                        <span>${escapeHtml(client.address || '—')}</span>
                    </div>
                    <div class="movement-detail-meta-item">
                        <label>RUC/NIT</label>
                        <span>${escapeHtml(client.taxId || '—')}</span>
                    </div>
                </div>
                <h4 class="movement-detail-section-title">
                    <i class="fas fa-history"></i> Movimientos recientes (${movements.length})
                </h4>
                <div class="table-responsive movement-detail-products">
                    <table class="table">
                        <thead>
                            <tr>
                                <th>Documento</th>
                                <th>Fecha</th>
                                <th>Tipo</th>
                                <th class="text-right">Total</th>
                                <th>Usuario</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${movementRows || `<tr><td colspan="5" class="text-center movement-detail-empty">No hay movimientos registrados</td></tr>`}
                        </tbody>
                    </table>
                </div>
            `;
        }

        showModal('client-detail-modal');
    } catch (error) {
        showAlert('Error al cargar los movimientos del cliente', 'error');
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('clients-table')) {
        loadClients();
    }
});
