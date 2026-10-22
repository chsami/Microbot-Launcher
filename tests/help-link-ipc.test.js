const registerExtraHandlers = require('../libs/extra-ipc-handlers.js');

const setup = async (openExternal) => {
    const handlers = {};
    const ipcMain = { handle: (channel, handler) => { handlers[channel] = handler; } };
    const log = { error: jest.fn() };
    await registerExtraHandlers(null, ipcMain, null, log, jest.fn(), openExternal);
    return { invoke: (key) => handlers['open-help-link']({}, key), log };
};

describe('open-help-link', () => {
    test('opens the Discord invite in the browser', async () => {
        const openExternal = jest.fn().mockResolvedValue();
        const { invoke } = await setup(openExternal);

        await expect(invoke('discord')).resolves.toEqual({ success: true });
        expect(openExternal).toHaveBeenCalledWith(registerExtraHandlers.HELP_LINKS.discord);
        expect(registerExtraHandlers.HELP_LINKS.discord).toMatch(/^https:\/\/discord\.gg\//);
    });

    test('refuses anything that is not a known link', async () => {
        const openExternal = jest.fn();
        const { invoke } = await setup(openExternal);

        await expect(invoke('https://evil.example')).resolves.toEqual({ error: 'Unknown help link' });
        await expect(invoke('toString')).resolves.toEqual({ error: 'Unknown help link' });
        await expect(invoke(undefined)).resolves.toEqual({ error: 'Unknown help link' });
        expect(openExternal).not.toHaveBeenCalled();
    });

    test('reports a browser that fails to open', async () => {
        const { invoke, log } = await setup(jest.fn().mockRejectedValue(new Error('no browser')));

        await expect(invoke('discord')).resolves.toEqual({ error: 'no browser' });
        expect(log.error).toHaveBeenCalled();
    });

    test('needs a way to open links', async () => {
        await expect(setup(undefined)).rejects.toThrow('missing required dependency: openExternal');
    });
});
