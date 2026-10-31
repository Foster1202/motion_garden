const flower = (x: number, y: number, color: string, scale = 1) => `<g transform="translate(${x} ${y}) scale(${scale})"><path d="M0 0q-6-20 2-41" stroke="#477651" stroke-width="4" fill="none"/><ellipse cx="-8" cy="-15" rx="10" ry="5" fill="#63925b" transform="rotate(25 -8 -15)"/><g fill="${color}"><ellipse cy="-48" rx="6" ry="10"/><ellipse cx="-10" cy="-40" rx="10" ry="6"/><ellipse cx="10" cy="-40" rx="10" ry="6"/><ellipse cy="-32" rx="6" ry="10"/></g><circle cy="-40" r="6" fill="#ecc26c"/></g>`;
const tree = (x: number, y: number, s: number) => `<g transform="translate(${x} ${y}) scale(${s})"><path d="M-17 30L-11-177 10-177 25 30Z" fill="#ab8159"/><path d="M0-50l-54-70m61 43 40-64" stroke="#ab8159" stroke-width="15" stroke-linecap="round"/><ellipse cy="-210" rx="111" ry="130" fill="#73946a"/><ellipse cx="-48" cy="-192" rx="83" ry="86" fill="#81a578"/><ellipse cx="39" cy="-239" rx="67" ry="85" fill="#90af7b"/><path d="M-61-223q-32 24-30 54M27-306q34 4 45 28" stroke="#a3bb8c" stroke-width="9" fill="none" stroke-linecap="round"/></g>`;
const fence = Array.from({ length: 23 }, (_, i) => `<path d="M${i * 80} 493v-90l12-12 12 12v90" fill="#e9d5ac" stroke="#c9b788" stroke-width="2"/>`).join('');
const flowers = [[83,772,'#fff8df',1.3],[160,699,'#df9d80',1],[230,831,'#fff8df',1.2],[322,750,'#ebc15e',0.8],[1330,794,'#fff8df',1.2],[1440,722,'#d9937c',1.2],[1510,811,'#fff8df',1.4],[1190,826,'#edbb5e',1]].map(([x,y,c,s])=>flower(x as number,y as number,c as string,s as number)).join('');

export const gardenSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="900" viewBox="0 0 1600 900">
<defs><linearGradient id="sky" x2="0" y2="1"><stop stop-color="#deeee7"/><stop offset="1" stop-color="#f2f4df"/></linearGradient><linearGradient id="lawn" x2="0" y2="1"><stop stop-color="#b8ce8d"/><stop offset="1" stop-color="#c9d998"/></linearGradient></defs>
<path fill="url(#sky)" d="M0 0h1600v900H0z"/>
<circle cx="1300" cy="162" r="65" fill="#fff2bf" opacity=".8"/>
<g fill="#fffdf1" opacity=".75"><path d="M78 198q-15-30 20-39 9-43 52-27 30-31 60 7 45-2 44 31 15 27-25 28z"/><path d="M945 179q-19-25 15-36 8-29 32-21 25-38 52-6 32-2 34 21 35 0 24 33z"/><path d="M1380 299q-9-21 20-28 20-31 40-3 41-17 46 20z"/></g>
<path d="M0 422Q190 269 430 385T904 376T1300 362T1600 366V620H0" fill="#ccdcaf"/>
<path d="M0 448Q239 347 500 426T1004 409T1600 432V637H0" fill="#b3ca99"/>
<g opacity=".8"><path d="M0 438h1600m-1600 34h1600" stroke="#d5c49b" stroke-width="14"/>${fence}</g>
<path d="M0 510Q400 456 801 505T1600 497V900H0" fill="url(#lawn)"/>
<path d="M1190 511q-209 100-103 198t-41 191H698q200-130 182-209t259-180" fill="#e7dbb2" opacity=".82"/>
<path d="M1128 551l59-3m-147 46 60 3m-87 94 65-1m-168 95 64 12m-42 66 76 4" stroke="#d6c69c" stroke-width="8" stroke-linecap="round"/>
${tree(60,563,1.25)}${tree(1545,556,1.35)}${tree(1420,466,.65)}
<g fill="#a0ba79"><ellipse cx="58" cy="619" rx="151" ry="55"/><ellipse cx="1540" cy="620" rx="180" ry="49"/></g>
<g fill="#b7cc89"><ellipse cx="47" cy="878" rx="238" ry="79"/><ellipse cx="1543" cy="900" rx="300" ry="104"/></g>
<g stroke="#92af70" stroke-width="3" fill="none" stroke-linecap="round"><path d="M376 663l-7-13m7 13 10-15M1234 641l-3-13m3 13 9-10M170 780l-4-16m4 16 11-11M1420 843l-6-19m6 19 13-15M487 824l-5-12m5 12 8-9M1336 560l-4-10m4 10 8-8"/></g>
${flowers}
</svg>`;
