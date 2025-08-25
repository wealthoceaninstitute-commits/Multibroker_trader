import 'bootstrap/dist/css/bootstrap.min.css';

export const metadata = { title: 'Trading Interface' };

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className="bg-light">{children}</body>
    </html>
  );
}
