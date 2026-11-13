export type PictureFormat = 'jpeg' | 'png' | 'webp';
export declare function pictureFormatOf(mime: string | null | undefined): PictureFormat | null;
export declare const MAX_LONG_EDGE = 3000;
export declare const MIN_LONG_EDGE = 1600;
export declare const MAX_UPSCALE = 2;
export interface ResizePlan {
    width: number;
    height: number;
    upscaled: boolean;
}
export declare function resizePlan(width: number, height: number): ResizePlan | null;
export interface Brightness {
    mean: number;
    stdev: number;
}
export declare const FLAT_STDEV = 45;
export declare const DARK_MEAN = 110;
export declare const DENOISE_MEAN = 80;
export declare function toneFor(b: Brightness | null): {
    lower: number;
    upper: number;
} | null;
export declare const needsDenoise: (b: Brightness | null) => boolean;
export declare function sharpenFor(upscaled: boolean): {
    sigma: number;
    m1: number;
    m2: number;
};
export declare const JPEG_QUALITY = 92;
export declare const WEBP_QUALITY = 92;
