(() => {
    'use strict';

    const TAGLINE = 'Happy Halloween';

    const isHalloweenSeason = (date) => {
        const month = date.getMonth();
        const day = date.getDate();
        return (month === 9 && day >= 20) || (month === 10 && day === 1);
    };

    if (typeof document === 'undefined') {
        module.exports = { TAGLINE, isHalloweenSeason };
        return;
    }

    if (!isHalloweenSeason(new Date())) {
        return;
    }

    const decorate = () => {
        const logo = document.querySelector('.game-logo');
        if (!logo || logo.querySelector('.hw-decor')) {
            return;
        }
        document.body.classList.add('is-halloween');

        const mark = logo.querySelector('.game-logo-mark');
        if (mark) {
            const pumpkin = document.createElement('img');
            pumpkin.src = 'images/halloween/pumpkin.svg';
            pumpkin.alt = '';
            pumpkin.className = 'hw-decor hw-pumpkin';
            mark.appendChild(pumpkin);
        }

        const tagline = logo.querySelector('.game-logo-tagline');
        if (tagline) {
            tagline.textContent = TAGLINE;
        }

        const sky = document.createElement('span');
        sky.className = 'hw-decor hw-sky';
        sky.setAttribute('aria-hidden', 'true');
        for (let i = 1; i <= 3; i++) {
            const bat = document.createElement('img');
            bat.src = 'images/halloween/bat.svg';
            bat.alt = '';
            bat.className = `hw-bat hw-bat-${i}`;
            sky.appendChild(bat);
        }
        logo.appendChild(sky);
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', decorate);
    } else {
        decorate();
    }
})();
