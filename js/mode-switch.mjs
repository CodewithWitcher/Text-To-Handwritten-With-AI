/**
 * Switches between Classic mode (the original tool, untouched) and Advanced
 * mode. Advanced mode's code is only downloaded the first time it is opened.
 */
const classicEl = document.querySelector('#classic-app');
const advancedEl = document.querySelector('#advanced-app');
const classicTab = document.querySelector('#mode-classic');
const advancedTab = document.querySelector('#mode-advanced');
let advancedLoaded = null;

function remember(mode) {
  try {
    window.localStorage.setItem('tth-mode', mode);
  } catch (e) {
    /* storage unavailable */
  }
}

function setMode(mode) {
  const advanced = mode === 'advanced';
  classicEl.hidden = advanced;
  advancedEl.hidden = !advanced;
  classicTab.setAttribute('aria-selected', String(!advanced));
  advancedTab.setAttribute('aria-selected', String(advanced));
  document.body.classList.toggle('mode-advanced', advanced);
  remember(mode);
  if (advanced && !advancedLoaded) {
    advancedLoaded = import('./advanced/main.mjs')
      .then((m) => m.init())
      .catch((err) => {
        advancedLoaded = null;
        console.error(err);
        advancedEl.prepend(
          Object.assign(document.createElement('p'), {
            className: 'adv-status error',
            textContent: `Advanced mode failed to load: ${err.message}`
          })
        );
      });
  }
}

classicTab.addEventListener('click', () => setMode('classic'));
advancedTab.addEventListener('click', () => setMode('advanced'));

let saved = 'classic';
try {
  saved = window.localStorage.getItem('tth-mode') || 'classic';
} catch (e) {
  /* storage unavailable */
}
const fromHash = window.location.hash === '#advanced' ? 'advanced' : null;
setMode(fromHash || saved);
