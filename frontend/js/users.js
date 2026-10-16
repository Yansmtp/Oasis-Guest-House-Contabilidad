let usersCache = [];

function openUserModal(user = null) {
    const form = document.getElementById('user-form');
    if (form) form.reset();

    document.getElementById('user-id').value = user?.id || '';
    document.getElementById('user-name-input').value = user?.name || '';
    document.getElementById('user-email-input').value = user?.email || '';
    document.getElementById('user-role-input').value = user?.role || 'USER';
    document.getElementById('user-password-input').value = '';

    const editing = !!user;
    document.getElementById('user-modal-title').textContent = editing ? 'Editar Usuario' : 'Nuevo Usuario';
    const req = document.getElementById('user-password-required');
    if (req) req.textContent = editing ? '' : '*';

    showModal('user-modal');
}

function closeUserModal() {
    closeModal();
}

async function loadUsers() {
    if (!isAdmin()) return;
    const card = document.getElementById('users-admin-card');
    if (card) card.style.display = 'block';

    try {
        const res = await apiRequest('/users');
        usersCache = res?.data || [];
        const tbody = document.querySelector('#users-table tbody');
        if (!tbody) return;
        tbody.innerHTML = '';

        if (!usersCache.length) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">Sin usuarios</td></tr>';
            return;
        }

        const compact = typeof isCompactListView === 'function' && isCompactListView();

        usersCache.forEach(u => {
            const row = document.createElement('tr');
            if (compact) {
                row.className = 'table-compact-row';
                row.innerHTML = `<td colspan="5" class="table-compact-cell">${buildUserListItemHtml(u)}</td>`;
            } else {
                row.innerHTML = `
                    <td>${u.name || ''}</td>
                    <td>${u.email || ''}</td>
                    <td><span class="status-badge ${u.role === 'ADMIN' ? 'status-active' : 'status-inactive'}">${u.role || 'USER'}</span></td>
                    <td>${formatDate(u.createdAt)}</td>
                    <td class="actions">
                        <button class="btn btn-sm btn-outline" onclick="editUser(${u.id})" title="Editar"><i class="fas fa-edit"></i></button>
                        <button class="btn btn-sm btn-danger" onclick="deleteUser(${u.id})" title="Eliminar"><i class="fas fa-trash"></i></button>
                    </td>
                `;
            }
            tbody.appendChild(row);
        });
    } catch (error) {
        showAlert(error.message || 'Error al cargar usuarios', 'error');
    }
}

function editUser(id) {
    const user = usersCache.find(u => u.id === id);
    if (!user) return;
    openUserModal(user);
}

async function saveUser() {
    const id = document.getElementById('user-id').value;
    const name = (document.getElementById('user-name-input').value || '').trim();
    const email = (document.getElementById('user-email-input').value || '').trim();
    const role = (document.getElementById('user-role-input').value || 'USER').trim().toUpperCase();
    const password = document.getElementById('user-password-input').value || '';

    if (!name || !email) {
        showAlert('Nombre y email son obligatorios', 'warning');
        return;
    }
    if (!id && password.length < 6) {
        showAlert('La contraseña debe tener al menos 6 caracteres', 'warning');
        return;
    }

    const payload = { name, email, role };
    if (password) payload.password = password;

    try {
        if (id) {
            await apiRequest(`/users/${id}`, {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            showAlert('Usuario actualizado', 'success');
        } else {
            await apiRequest('/users', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            showAlert('Usuario creado', 'success');
        }
        closeUserModal();
        await loadUsers();
    } catch (error) {
        showAlert(error.message || 'Error al guardar usuario', 'error');
    }
}

async function deleteUser(id) {
    const ok = confirm('¿Eliminar este usuario?');
    if (!ok) return;
    try {
        await apiRequest(`/users/${id}`, { method: 'DELETE' });
        showAlert('Usuario eliminado', 'success');
        await loadUsers();
    } catch (error) {
        showAlert(error.message || 'Error al eliminar usuario', 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('users-new-btn');
    if (btn) {
        btn.addEventListener('click', () => openUserModal());
    }
});

window.loadUsers = loadUsers;
window.saveUser = saveUser;
window.editUser = editUser;
window.deleteUser = deleteUser;
window.closeUserModal = closeUserModal;
