const standingTop = `
  <circle cx="100" cy="30" r="13" fill="#f7d2a1"/>
  <path d="M87 29c0-16 23-20 27-2-9 1-13-1-16-5-4 5-7 7-11 7" fill="#6b5346"/>
  <path d="M82 69 74 94m44-25 8 25" stroke="#f7d2a1" stroke-width="10" stroke-linecap="round"/>
  <path d="M81 67c1-28 38-28 38 0l-3 31H84Z" fill="#83ae91"/>
  <path d="M88 33h2m12 0h2" stroke="#685448" stroke-width="2" stroke-linecap="round"/>`;

function figure(stepping: boolean) {
  const left = stepping ? 'M92 92l-8 18 5 20h-12' : 'M92 92l-6 24v23H74';
  return `<svg viewBox="0 0 200 157" aria-hidden="true">
    <ellipse cx="100" cy="144" rx="43" ry="5" fill="#43665a28"/>
    <g class="${stepping ? 'home-demo-walker' : 'home-demo-shift'}" stroke-linejoin="round">
      <path class="home-demo-left" d="${left}" stroke="#4f7471" fill="none" stroke-width="11" stroke-linecap="round"/>
      <path class="home-demo-right" d="M108 92l6 24v23h12" stroke="#345257" fill="none" stroke-width="11" stroke-linecap="round"/>
      ${standingTop}
    </g>
  </svg>`;
}

export function createHomeIntroDemo() {
  const demo = document.createElement('div');
  demo.className = 'home-demo';
  demo.setAttribute('aria-hidden', 'true');
  demo.innerHTML = `
    <div class="home-demo-tile">${figure(true)}<span>原地踏步</span></div>
    <div class="home-demo-tile">${figure(false)}<b class="home-demo-arrows">← <i></i> →</b><span>輕輕左右移</span></div>`;
  return demo;
}
