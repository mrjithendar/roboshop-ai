import Link from "next/link";

export default function NotFound() {
  return (
    <>
      <h1 className="text-3xl font-bold tracking-tight">Page not found</h1>
      <p className="mt-3">
        That page does not exist. <Link href="/" className="underline">Go to the homepage</Link>.
      </p>
    </>
  );
}
