import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'GrupResumo · Configuração',
  description: 'Resumo automatico de grupos de WhatsApp e Telegram',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-br">
      <body>{children}</body>
    </html>
  );
}
