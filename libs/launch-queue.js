module.exports = function createLaunchQueue() {
    let tail = Promise.resolve();
    let running = 0;

    const run = (task) => {
        running += 1;
        const result = tail.then(() => task());
        tail = result.catch(() => {}).finally(() => {
            running -= 1;
        });
        return result;
    };

    return { run, busy: () => running > 0 };
};
