export interface ProxyProvider {
  name: string;
  enabled: boolean;
  proxies: string[];
}

export const PROXY_PROVIDERS: Record<string, ProxyProvider> = {
  webshare: {
    name: 'Webshare.io',
    enabled: true,
    proxies: [
      'http://xixdqxlc:2xyte7egql4w@31.59.20.176:6754',
      'http://xixdqxlc:2xyte7egql4w@45.38.107.97:6014',
      'http://xixdqxlc:2xyte7egql4w@64.137.96.74:6641',
      'http://xixdqxlc:2xyte7egql4w@198.23.243.226:6361',
      'http://xixdqxlc:2xyte7egql4w@38.154.185.97:6370',
      'http://xixdqxlc:2xyte7egql4w@84.247.60.125:6095',
      'http://xixdqxlc:2xyte7egql4w@142.111.67.146:5611',
      'http://xixdqxlc:2xyte7egql4w@191.96.254.138:6185',
      'http://xixdqxlc:2xyte7egql4w@31.58.9.4:6077',
      'http://xixdqxlc:2xyte7egql4w@198.46.161.42:5092',
    ],
  },
  scraperapi: {
    name: 'ScraperAPI',
    enabled: true,
    proxies: [
      'http://scraperapi:f1e22efa20057a85cf8353e88e2ae741@proxy-server.scraperapi.com:8001',
    ],
  },
};