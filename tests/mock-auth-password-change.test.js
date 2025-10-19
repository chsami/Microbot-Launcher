const mockAuth = require('../libs/mock-auth');
const { EventEmitter } = require('events');

// Mock electron-log
const mockLog = {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn()
};

// Mock IPC Main
class MockIpcMain extends EventEmitter {
    constructor() {
        super();
        this.handlers = new Map();
    }

    handle(channel, handler) {
        this.handlers.set(channel, handler);
    }

    async invoke(channel, ...args) {
        const handler = this.handlers.get(channel);
        if (handler) {
            return await handler(null, ...args);
        }
        throw new Error(`No handler for channel: ${channel}`);
    }
}

describe('Mock Auth Password Change', () => {
    let mockIpcMain;
    let originalEnv;

    beforeAll(() => {
        originalEnv = process.env;
        process.env = { ...originalEnv, MOCK_AUTH: '1', MOCK_USERS: 'test@example.com:Password123' };
    });

    afterAll(() => {
        process.env = originalEnv;
    });

    beforeEach(() => {
        mockIpcMain = new MockIpcMain();
        mockAuth({ ipcMain: mockIpcMain, log: mockLog });
    });

    test('should require current password for password change', async () => {
        // First sign in
        const signInResult = await mockIpcMain.invoke('auth:signin', {
            email: 'test@example.com',
            password: 'Password123'
        });
        expect(signInResult.success).toBe(true);

        // Try to change password without current password
        const changeResult1 = await mockIpcMain.invoke('auth:changepw', {
            newPassword: 'NewPassword123'
        });
        expect(changeResult1.error).toBe('Current password is required.');

        // Try with empty current password
        const changeResult2 = await mockIpcMain.invoke('auth:changepw', {
            currentPassword: '',
            newPassword: 'NewPassword123'
        });
        expect(changeResult2.error).toBe('Current password is required.');
    });

    test('should validate current password before allowing change', async () => {
        // First sign in
        const signInResult = await mockIpcMain.invoke('auth:signin', {
            email: 'test@example.com',
            password: 'Password123'
        });
        expect(signInResult.success).toBe(true);

        // Try to change password with wrong current password
        const changeResult = await mockIpcMain.invoke('auth:changepw', {
            currentPassword: 'WrongPassword',
            newPassword: 'NewPassword123'
        });
        expect(changeResult.error).toBe('Current password is incorrect.');
    });

    test('should not allow same password as current', async () => {
        // First sign in
        const signInResult = await mockIpcMain.invoke('auth:signin', {
            email: 'test@example.com',
            password: 'Password123'
        });
        expect(signInResult.success).toBe(true);

        // Try to change password to same password
        const changeResult = await mockIpcMain.invoke('auth:changepw', {
            currentPassword: 'Password123',
            newPassword: 'Password123'
        });
        expect(changeResult.error).toBe('New password must be different from current password.');
    });

    test('should successfully change password when current password is correct', async () => {
        // First sign in
        const signInResult = await mockIpcMain.invoke('auth:signin', {
            email: 'test@example.com',
            password: 'Password123'
        });
        expect(signInResult.success).toBe(true);

        // Successfully change password
        const changeResult = await mockIpcMain.invoke('auth:changepw', {
            currentPassword: 'Password123',
            newPassword: 'NewPassword123'
        });
        expect(changeResult.success).toBe(true);

        // Sign out and verify new password works
        await mockIpcMain.invoke('auth:signout');

        const signInWithNewResult = await mockIpcMain.invoke('auth:signin', {
            email: 'test@example.com',
            password: 'NewPassword123'
        });
        expect(signInWithNewResult.success).toBe(true);

        // Verify old password no longer works
        await mockIpcMain.invoke('auth:signout');
        const signInWithOldResult = await mockIpcMain.invoke('auth:signin', {
            email: 'test@example.com',
            password: 'Password123'
        });
        expect(signInWithOldResult.error).toBe('Invalid email or password.');
    });

    test('should enforce minimum password length for new password', async () => {
        // First sign in
        const signInResult = await mockIpcMain.invoke('auth:signin', {
            email: 'test@example.com',
            password: 'Password123'
        });
        expect(signInResult.success).toBe(true);

        // Try to change to a password that's too short
        const changeResult = await mockIpcMain.invoke('auth:changepw', {
            currentPassword: 'Password123',
            newPassword: 'short'
        });
        expect(changeResult.error).toBe('New password must be at least 8 characters.');
    });

    test('should require authentication to change password', async () => {
        // Try to change password without being signed in
        const changeResult = await mockIpcMain.invoke('auth:changepw', {
            currentPassword: 'Password123',
            newPassword: 'NewPassword123'
        });
        expect(changeResult.error).toBe('Not authenticated.');
    });
});