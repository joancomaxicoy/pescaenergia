// Global authentication utilities
class AuthManager {
    constructor() {
        this.setupDropdownHandlers();
        this.setupForgotPasswordModal();
    }

    // Setup forgot password modal functionality
    setupForgotPasswordModal() {
        document.addEventListener('DOMContentLoaded', () => {
            const forgotPasswordLink = document.getElementById('forgotPasswordLink');
            const forgotPasswordModal = document.getElementById('forgotPasswordModal');
            const closeForgotModal = document.getElementById('closeForgotModal');
            const cancelForgotBtn = document.getElementById('cancelForgotBtn');
            const forgotPasswordForm = document.getElementById('forgotPasswordForm');

            // Show modal when forgot password link is clicked
            if (forgotPasswordLink) {
                forgotPasswordLink.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.showForgotPasswordModal();
                });
            }

            // Close modal handlers
            if (closeForgotModal) {
                closeForgotModal.addEventListener('click', () => {
                    this.hideForgotPasswordModal();
                });
            }

            if (cancelForgotBtn) {
                cancelForgotBtn.addEventListener('click', () => {
                    this.hideForgotPasswordModal();
                });
            }

            // Close modal when clicking outside
            if (forgotPasswordModal) {
                forgotPasswordModal.addEventListener('click', (e) => {
                    if (e.target === forgotPasswordModal) {
                        this.hideForgotPasswordModal();
                    }
                });
            }

            // Handle forgot password form submission
            if (forgotPasswordForm) {
                forgotPasswordForm.addEventListener('submit', async (e) => {
                    e.preventDefault();
                    await this.handleForgotPasswordSubmit();
                });
            }
        });
    }

    // Show forgot password modal
    showForgotPasswordModal() {
        const modal = document.getElementById('forgotPasswordModal');
        const emailInput = document.getElementById('forgotEmail');
        
        if (modal) {
            modal.style.display = 'flex';
            // Clear previous values and errors
            if (emailInput) {
                emailInput.value = '';
                emailInput.classList.remove('error');
            }
            this.clearForgotPasswordErrors();
        }
    }

    // Hide forgot password modal
    hideForgotPasswordModal() {
        const modal = document.getElementById('forgotPasswordModal');
        if (modal) {
            modal.style.display = 'none';
        }
    }

    // Handle forgot password form submission
    async handleForgotPasswordSubmit() {
        const emailInput = document.getElementById('forgotEmail');
        const sendResetBtn = document.getElementById('sendResetBtn');
        const forgotLoading = document.getElementById('forgotLoading');
        const btnText = sendResetBtn.querySelector('.btn-text');

        const email = emailInput.value.trim();

        // Clear previous errors
        this.clearForgotPasswordErrors();

        // Validation
        if (!email) {
            this.showForgotPasswordError('forgotEmail', 'El correu electrònic és obligatori');
            return;
        }

        if (!this.isValidEmail(email)) {
            this.showForgotPasswordError('forgotEmail', 'Format de correu electrònic invàlid');
            return;
        }

        // Show loading
        sendResetBtn.disabled = true;
        btnText.style.display = 'none';
        forgotLoading.classList.remove('loading-hidden');

        try {
            const result = await this.forgotPassword(email);
            
            if (result.success) {
                this.hideForgotPasswordModal();
                this.showAlert('success', 'Si el correu existeix, rebràs un enllaç per restablir la contrasenya.');
            } else {
                this.showAlert('error', result.error || 'Error enviant el correu de recuperació');
            }
        } catch (error) {
            console.error('Forgot password error:', error);
            this.showAlert('error', 'Error de connexió. Torna-ho a intentar.');
        } finally {
            // Hide loading
            sendResetBtn.disabled = false;
            btnText.style.display = 'inline';
            forgotLoading.classList.add('loading-hidden');
        }
    }

    // Show forgot password field error
    showForgotPasswordError(fieldId, message) {
        const errorEl = document.getElementById(fieldId + 'Error');
        const inputEl = document.getElementById(fieldId);
        
        if (errorEl) errorEl.textContent = message;
        if (inputEl) inputEl.classList.add('error');
    }

    // Clear forgot password errors
    clearForgotPasswordErrors() {
        const errorEl = document.getElementById('forgotEmailError');
        const inputEl = document.getElementById('forgotEmail');
        
        if (errorEl) errorEl.textContent = '';
        if (inputEl) inputEl.classList.remove('error');
    }

    // Forgot password API call
    async forgotPassword(email) {
        try {
            const response = await fetch('/api/auth/forgot-password', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (response.ok) {
                return { success: true, data };
            } else {
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Forgot password error:', error);
            return { success: false, error: 'Error de connexió' };
        }
    }

    // Login with email and password
    async login(email, password) {
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email, password })
            });

            const data = await response.json();

            if (response.ok) {
                return { success: true, data };
            } else {
                return { success: false, error: data.error, code: data.code };
            }
        } catch (error) {
            console.error('Login error:', error);
            return { success: false, error: 'Error de connexió' };
        }
    }

    // Register new user
    async register(name, email, password) {
        try {
            const response = await fetch('/api/auth/register', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ name, email, password })
            });

            const data = await response.json();

            if (response.ok) {
                return { success: true, data };
            } else {
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Register error:', error);
            return { success: false, error: 'Error de connexió' };
        }
    }


    // Handle successful authentication
    handleAuthSuccess(authData) {
        // Store tokens
        this.setAuthToken(authData.accessToken);
        if (authData.refreshToken) {
            this.setRefreshToken(authData.refreshToken);
        }

        // Check if user needs to set initial password
        if (authData.user.is_temp_password) {
            window.location.href = '/area-usuari/set-initial-password';
            return;
        }

        // Check if user needs to assign CUPS
        if (!authData.user.cups) {
            window.location.href = '/area-usuari/assignar-cups';
        } else {
            window.location.href = '/area-usuari';
        }
    }

    // Store auth token
    setAuthToken(token) {
        // Store in both cookie and localStorage for flexibility
        document.cookie = `authToken=${token}; path=/; max-age=86400; SameSite=Strict`;
        localStorage.setItem('authToken', token);
    }

    // Store refresh token
    setRefreshToken(token) {
        document.cookie = `refreshToken=${token}; path=/; max-age=604800; SameSite=Strict`;
        localStorage.setItem('refreshToken', token);
    }

    // Get auth token
    getAuthToken() {
        // Try cookie first, then localStorage
        const cookies = document.cookie.split(';');
        for (let cookie of cookies) {
            const [name, value] = cookie.trim().split('=');
            if (name === 'authToken') {
                return value;
            }
        }
        return localStorage.getItem('authToken');
    }

    // Clear auth tokens
    clearAuthTokens() {
        document.cookie = 'authToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        document.cookie = 'refreshToken=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        localStorage.removeItem('authToken');
        localStorage.removeItem('refreshToken');
    }

    // Logout
    async logout() {
        this.clearAuthTokens();
        window.location.href = '/area-usuari/login';
    }

    // Setup dropdown handlers
    setupDropdownHandlers() {
        document.addEventListener('DOMContentLoaded', () => {
            const userDropdown = document.getElementById('userDropdown');
            const dropdownMenu = document.getElementById('userDropdownMenu');
            const showProfileBtn = document.getElementById('showProfileBtn');
            const logoutBtn = document.getElementById('logoutBtn');

            if (userDropdown && dropdownMenu) {
                userDropdown.addEventListener('click', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    
                    const isOpen = dropdownMenu.classList.contains('show');
                    
                    // Close all dropdowns first
                    document.querySelectorAll('.dropdown-menu').forEach(menu => {
                        menu.classList.remove('show');
                    });
                    document.querySelectorAll('.dropdown-toggle').forEach(toggle => {
                        toggle.classList.remove('active');
                    });

                    // Toggle current dropdown
                    if (!isOpen) {
                        dropdownMenu.classList.add('show');
                        userDropdown.classList.add('active');
                    }
                });

                // Close dropdown when clicking outside
                document.addEventListener('click', () => {
                    dropdownMenu.classList.remove('show');
                    userDropdown.classList.remove('active');
                });
            }

            // Handle profile button
            if (showProfileBtn) {
                showProfileBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    if (typeof window.showProfile === 'function') {
                        window.showProfile();
                    }
                });
            }

            // Handle logout button
            if (logoutBtn) {
                logoutBtn.addEventListener('click', (e) => {
                    e.preventDefault();
                    this.logout();
                });
            }
        });
    }

    // Show alert message
    showAlert(type, message) {
        const alertContainer = document.getElementById('alert-container');
        if (alertContainer) {
            alertContainer.innerHTML = `
                <div class="alert alert-${type}">
                    ${message}
                </div>
            `;

            // Auto-hide success messages
            if (type === 'success') {
                setTimeout(() => {
                    alertContainer.innerHTML = '';
                }, 5000);
            }
        }
    }

    // Show email verification alert with resend option
    showEmailVerificationAlert(email, message) {
        const alertContainer = document.getElementById('alert-container');
        if (alertContainer) {
            alertContainer.innerHTML = `
                <div class="alert alert-warning">
                    <div style="margin-bottom: 10px;">${message}</div>
                    <button type="button" class="btn btn-secondary" id="resendVerificationBtn" style="padding: 8px 16px; font-size: 14px;">
                        Reenviar correu de verificació
                    </button>
                </div>
            `;

            // Add click handler for resend button
            const resendBtn = document.getElementById('resendVerificationBtn');
            if (resendBtn) {
                resendBtn.addEventListener('click', async () => {
                    resendBtn.disabled = true;
                    resendBtn.textContent = 'Enviant...';
                    
                    try {
                        const result = await this.resendEmailVerification(email);
                        if (result.success) {
                            this.showAlert('success', 'Correu de verificació enviat correctament. Revisa la teva safata d\'entrada.');
                        } else {
                            this.showAlert('error', result.error || 'Error enviant el correu de verificació');
                        }
                    } catch (error) {
                        console.error('Error resending verification:', error);
                        this.showAlert('error', 'Error de connexió');
                    } finally {
                        resendBtn.disabled = false;
                        resendBtn.textContent = 'Reenviar correu de verificació';
                    }
                });
            }
        }
    }

    // Resend email verification
    async resendEmailVerification(email) {
        try {
            const response = await fetch('/api/auth/resend-verification', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ email })
            });

            const data = await response.json();

            if (response.ok) {
                return { success: true, data };
            } else {
                return { success: false, error: data.error };
            }
        } catch (error) {
            console.error('Resend verification error:', error);
            return { success: false, error: 'Error de connexió' };
        }
    }

    // Validate email format
    isValidEmail(email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return emailRegex.test(email);
    }

    // Validate password strength
    validatePassword(password) {
        const errors = [];
        
        if (password.length < 8) {
            errors.push('La contrasenya ha de tenir almenys 8 caràcters');
        }
        
        if (!/[A-Z]/.test(password)) {
            errors.push('La contrasenya ha de tenir almenys una lletra majúscula');
        }
        
        if (!/[a-z]/.test(password)) {
            errors.push('La contrasenya ha de tenir almenys una lletra minúscula');
        }
        
        if (!/[0-9]/.test(password)) {
            errors.push('La contrasenya ha de tenir almenys un número');
        }

        return {
            isValid: errors.length === 0,
            errors: errors
        };
    }
}

// Initialize auth manager
const authManager = new AuthManager();

// Global functions for templates
function logout() {
    authManager.logout();
}

function showProfile() {
    if (typeof window.showProfile === 'function') {
        window.showProfile();
    }
}

// Switch between login and register forms
function showLoginForm() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    loginForm.classList.remove('form-hidden');
    loginForm.classList.add('form-visible');
    registerForm.classList.remove('form-visible');
    registerForm.classList.add('form-hidden');
    
    document.querySelector('.auth-title').textContent = 'Àrea d\'Usuari';
    document.querySelector('.auth-subtitle').textContent = 'Accedeix al teu compte per gestionar la teva energia';
    clearErrors();
}

function showRegisterForm() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');
    
    loginForm.classList.remove('form-visible');
    loginForm.classList.add('form-hidden');
    registerForm.classList.remove('form-hidden');
    registerForm.classList.add('form-visible');
    
    document.querySelector('.auth-title').textContent = 'Crear Compte';
    document.querySelector('.auth-subtitle').textContent = 'Registra\'t per començar a gestionar la teva energia';
    clearErrors();
}

function clearErrors() {
    document.querySelectorAll('.form-error').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-success').forEach(el => el.textContent = '');
    document.querySelectorAll('.form-input').forEach(el => el.classList.remove('error'));
    document.getElementById('alert-container').innerHTML = '';
}

// Login form handler
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('loginForm');
    const registerForm = document.getElementById('registerForm');

    // Setup form switching links
    const showRegisterLink = document.getElementById('showRegisterLink');
    const showLoginLink = document.getElementById('showLoginLink');

    if (showRegisterLink) {
        showRegisterLink.addEventListener('click', function(e) {
            e.preventDefault();
            showRegisterForm();
        });
    }

    if (showLoginLink) {
        showLoginLink.addEventListener('click', function(e) {
            e.preventDefault();
            showLoginForm();
        });
    }

    // Login form submission
    if (loginForm) {
        loginForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('loginEmail').value.trim();
            const password = document.getElementById('loginPassword').value;
            const loginBtn = document.getElementById('loginBtn');
            const loginLoading = document.getElementById('loginLoading');
            const btnText = loginBtn.querySelector('.btn-text');

            // Clear previous errors
            clearFormErrors('login');

            // Validation
            if (!email) {
                showFieldError('loginEmail', 'El correu electrònic és obligatori');
                return;
            }

            if (!authManager.isValidEmail(email)) {
                showFieldError('loginEmail', 'Format de correu electrònic invàlid');
                return;
            }

            if (!password) {
                showFieldError('loginPassword', 'La contrasenya és obligatòria');
                return;
            }

            // Show loading
            loginBtn.disabled = true;
            btnText.style.display = 'none';
            loginLoading.classList.remove('loading-hidden');

            try {
                const result = await authManager.login(email, password);
                
                if (result.success) {
                    authManager.handleAuthSuccess(result.data);
                } else {
                    // Check if it's an email verification error by code
                    if (result.code === 'EMAIL_NOT_VERIFIED') {
                        const catalanMessage = 'Has de verificar el teu correu abans d\'iniciar sessió';
                        authManager.showEmailVerificationAlert(email, catalanMessage);
                    } else {
                        authManager.showAlert('error', result.error);
                    }
                }
            } finally {
                // Hide loading
                loginBtn.disabled = false;
                btnText.style.display = 'inline';
                loginLoading.classList.add('loading-hidden');
            }
        });
    }

    // Register form submission
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const name = document.getElementById('registerName').value.trim();
            const email = document.getElementById('registerEmail').value.trim();
            const password = document.getElementById('registerPassword').value;
            const passwordConfirm = document.getElementById('registerPasswordConfirm').value;
            const registerBtn = document.getElementById('registerBtn');
            const registerLoading = document.getElementById('registerLoading');
            const btnText = registerBtn.querySelector('.btn-text');

            // Clear previous errors
            clearFormErrors('register');

            // Validation
            let hasErrors = false;

            if (!name) {
                showFieldError('registerName', 'El nom és obligatori');
                hasErrors = true;
            }

            if (!email) {
                showFieldError('registerEmail', 'El correu electrònic és obligatori');
                hasErrors = true;
            } else if (!authManager.isValidEmail(email)) {
                showFieldError('registerEmail', 'Format de correu electrònic invàlid');
                hasErrors = true;
            }

            const passwordValidation = authManager.validatePassword(password);
            if (!passwordValidation.isValid) {
                showFieldError('registerPassword', passwordValidation.errors[0]);
                hasErrors = true;
            }

            if (password !== passwordConfirm) {
                showFieldError('registerPasswordConfirm', 'Les contrasenyes no coincideixen');
                hasErrors = true;
            }

            if (hasErrors) return;

            // Show loading
            registerBtn.disabled = true;
            btnText.style.display = 'none';
            registerLoading.classList.remove('loading-hidden');

            try {
                const result = await authManager.register(name, email, password);
                
                if (result.success) {
                    authManager.showAlert('success', 'Compte creat correctament! Revisa el teu correu per verificar el compte.');
                    // Switch to login form after successful registration
                    setTimeout(() => {
                        showLoginForm();
                    }, 3000);
                } else {
                    authManager.showAlert('error', result.error);
                }
            } finally {
                // Hide loading
                registerBtn.disabled = false;
                btnText.style.display = 'inline';
                registerLoading.classList.add('loading-hidden');
            }
        });
    }

});

// Helper functions
function showFieldError(fieldId, message) {
    const errorEl = document.getElementById(fieldId + 'Error');
    const inputEl = document.getElementById(fieldId);
    
    if (errorEl) errorEl.textContent = message;
    if (inputEl) inputEl.classList.add('error');
}

function clearFormErrors(formPrefix) {
    document.querySelectorAll(`#${formPrefix}Form .form-error`).forEach(el => el.textContent = '');
    document.querySelectorAll(`#${formPrefix}Form .form-input`).forEach(el => el.classList.remove('error'));
}
