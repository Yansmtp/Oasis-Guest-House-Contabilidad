// Manejo de autenticación
async function login(email, password) {
    try {
        const response = await apiRequest('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ email, password })
        });

        setToken(response.access_token);
        setCurrentUser(response.user);
        showMainApp();
        loadDashboard();
        showAlert('Inicio de sesión exitoso', 'success');
        
        return true;
    } catch (error) {
        showAlert(error.message || 'Error al iniciar sesión', 'error');
        return false;
    }
}

async function register(name, email, password) {
    try {
        const response = await apiRequest('/auth/register', {
            method: 'POST',
            body: JSON.stringify({ name, email, password })
        });

        showAlert('Registro exitoso. Por favor, inicie sesión.', 'success');
        showLogin();
        
        return true;
    } catch (error) {
        if ((error.message || '').includes('403')) {
            showAlert('Solo un administrador puede crear usuarios', 'warning');
        } else {
            showAlert(error.message || 'Error al registrar usuario', 'error');
        }
        return false;
    }
}

function logout() {
    removeToken();
    clearCurrentUser();
    showLogin();
    showAlert('Sesión cerrada exitosamente', 'info');
}

function showLogin() {
    document.getElementById('login-section').style.display = 'block';
    document.getElementById('register-section').style.display = 'none';
    document.getElementById('main-content').style.display = 'none';
    resetForm('login-form');
}

function showRegister() {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('register-section').style.display = 'block';
    document.getElementById('main-content').style.display = 'none';
    resetForm('register-form');
}

function showMainApp() {
    document.getElementById('login-section').style.display = 'none';
    document.getElementById('register-section').style.display = 'none';
    document.getElementById('main-content').style.display = 'block';
    
    // Actualizar información del usuario
    const user = getCurrentUser();
    if (user) {
        document.getElementById('user-name').textContent = user.name;
    }

    const companyLink = document.querySelector('.nav-link[data-section="company"]');
    if (companyLink) {
        companyLink.style.display = isAdmin() ? '' : 'none';
    }
}

// Event Listeners
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    
    if (!email || !password) {
        showAlert('Por favor, complete todos los campos', 'warning');
        return;
    }
    
    await login(email, password);
});

document.getElementById('register-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const name = document.getElementById('register-name').value;
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    
    if (!name || !email || !password || !confirm) {
        showAlert('Por favor, complete todos los campos', 'warning');
        return;
    }
    
    if (password !== confirm) {
        showAlert('Las contraseñas no coinciden', 'warning');
        return;
    }
    
    if (password.length < 6) {
        showAlert('La contraseña debe tener al menos 6 caracteres', 'warning');
        return;
    }
    
    await register(name, email, password);
});
