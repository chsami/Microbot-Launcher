(() => {
    'use strict';

    const TAGLINE = 'Happy Halloween';

    const isHalloweenSeason = (date) => {
        const month = date.getMonth();
        const day = date.getDate();
        return (month === 9 && day >= 20) || (month === 10 && day === 1);
    };

    const msUntilNextDay = (date) => {
        const next = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1);
        return next.getTime() - date.getTime() + 1000;
    };

    if (typeof document === 'undefined') {
        module.exports = { TAGLINE, isHalloweenSeason, msUntilNextDay };
        return;
    }

    let defaultTagline = null;

    const decorate = (logo) => {
        if (logo.querySelector('.hw-decor')) {
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
            defaultTagline = tagline.textContent;
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

    const undecorate = (logo) => {
        document.body.classList.remove('is-halloween');
        logo.querySelectorAll('.hw-decor').forEach((element) => element.remove());
        const tagline = logo.querySelector('.game-logo-tagline');
        if (tagline && defaultTagline !== null) {
            tagline.textContent = defaultTagline;
        }
    };

    const apply = () => {
        const now = new Date();
        const logo = document.querySelector('.game-logo');
        if (logo) {
            if (isHalloweenSeason(now)) {
                decorate(logo);
            } else {
                undecorate(logo);
            }
        }
        setTimeout(apply, msUntilNextDay(now));
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', apply);
    } else {
        apply();
    }
})();
