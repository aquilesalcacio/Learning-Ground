import { cn } from "cn";
import Image from "next/image";
import Link from "next/link";

// The app's logo. Files live in public/brand (see docs/design/brief.md, "Logo"):
// learning-grounds-wordmark.png  the name and bulb, for small spaces like headers
// learning-grounds-logo.png      with the perspective grid, for large spaces like a login page
// ...-wordmark-light.png         white, for dark backgrounds
// ...-logo-original.png          the file as supplied
const WORDMARK = { src: "/brand/learning-grounds-wordmark.png", width: 1100, height: 171 };

export function BrandLogo({ className, href = "/" }: { className?: string; href?: string }) {
  return (
    <Link
      href={href}
      aria-label="Learning Grounds, home"
      className={cn(
        "inline-flex shrink-0 items-center rounded-md outline-none transition-transform duration-(--dur-base) ease-spring hover:scale-[1.03] focus-visible:ring-3 focus-visible:ring-ring/50 active:scale-[0.97]",
        className,
      )}
    >
      <Image
        src={WORDMARK.src}
        alt="Learning Grounds"
        width={WORDMARK.width}
        height={WORDMARK.height}
        priority
        className="h-full w-auto"
      />
    </Link>
  );
}
