const usd = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const num = new Intl.NumberFormat('en-US');
const pct = new Intl.NumberFormat('en-US', {
  style: 'percent',
  maximumFractionDigits: 2,
});

export const fmt = {
  usd: (n: number) => usd.format(n),
  num: (n: number) => num.format(Math.round(n)),
  pct: (n: number) => pct.format(n),
  ecpm: (n: number) => usd.format(n),
};
