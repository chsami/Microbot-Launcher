const createLaunchQueue = require('../libs/launch-queue.js');

describe('launch queue', () => {
    test('runs launches one after another and says when it is busy', async () => {
        const queue = createLaunchQueue();
        const order = [];
        let release;
        expect(queue.busy()).toBe(false);
        const first = queue.run(() => new Promise((resolve) => (release = resolve)).then(() => order.push('first')));
        const second = queue.run(() => order.push('second'));
        expect(queue.busy()).toBe(true);
        await new Promise((resolve) => setImmediate(resolve));
        expect(order).toEqual([]);
        release();
        await Promise.all([first, second]);
        expect(order).toEqual(['first', 'second']);
        await new Promise((resolve) => setImmediate(resolve));
        expect(queue.busy()).toBe(false);
    });

    test('a failed launch does not block the next one', async () => {
        const queue = createLaunchQueue();
        await expect(queue.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
        await expect(queue.run(() => 'next')).resolves.toBe('next');
    });
});
