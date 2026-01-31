import "./globals.css";

export const metadata = {
  title: "MoltTactics Viewer",
  description: "Spectator view for MoltTactics matches"
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
