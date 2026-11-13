export declare class PictureEnhancerService {
    private readonly logger;
    get enabled(): boolean;
    handles(mime: string | null | undefined): boolean;
    enhance(input: Buffer, mime: string | null | undefined): Promise<Buffer | null>;
    private brightness;
}
