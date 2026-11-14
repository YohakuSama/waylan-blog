import { useRef } from "react";
import { ArtImage, Dialog } from "../../components/UI";

/** Enlarged-image dialog keeps its last content during the exit animation. */
export type Zoomed = { src: string; alt: string; from?: Element };
export function ImageViewer({ image, onClose }: {
  image: Zoomed | null;
  onClose: () => void;
}) {
  const lastImage = useRef<Zoomed | null>(null);
  if (image) lastImage.current = image;
  const visible = image ?? lastImage.current;
  return (
    <Dialog open={!!image} onClose={onClose}
      label={visible?.alt || "放大图片"} className="image-dialog"
      origin={visible?.from}>
      {visible && <ArtImage src={visible.src} alt={visible.alt} />}
    </Dialog>
  );
}
