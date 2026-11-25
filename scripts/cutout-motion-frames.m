#import <Foundation/Foundation.h>
#import <Vision/Vision.h>
#import <CoreImage/CoreImage.h>
#import <CoreGraphics/CoreGraphics.h>

static BOOL CutOutImage(NSURL *sourceURL, NSURL *outputURL, CIContext *context, NSError **error) {
    CIImage *source = [CIImage imageWithContentsOfURL:sourceURL];
    if (!source) {
        if (error) {
            *error = [NSError errorWithDomain:@"MotionCutout" code:1 userInfo:@{
                NSLocalizedDescriptionKey: [NSString stringWithFormat:@"无法读取图片：%@", sourceURL.path]
            }];
        }
        return NO;
    }

    VNImageRequestHandler *handler = [[VNImageRequestHandler alloc] initWithCIImage:source options:@{}];
    VNGeneratePersonSegmentationRequest *request = [VNGeneratePersonSegmentationRequest new];
    request.usesCPUOnly = YES;
    request.qualityLevel = VNGeneratePersonSegmentationRequestQualityLevelAccurate;
    request.outputPixelFormat = kCVPixelFormatType_OneComponent8;
    if (![handler performRequests:@[request] error:error]) return NO;

    VNPixelBufferObservation *observation = request.results.firstObject;
    if (!observation) {
        if (error) {
            *error = [NSError errorWithDomain:@"MotionCutout" code:2 userInfo:@{
                NSLocalizedDescriptionKey: [NSString stringWithFormat:@"没有识别到人物：%@", sourceURL.path]
            }];
        }
        return NO;
    }

    CIImage *rawMask = [CIImage imageWithCVPixelBuffer:observation.pixelBuffer];
    CGFloat scaleX = source.extent.size.width / rawMask.extent.size.width;
    CGFloat scaleY = source.extent.size.height / rawMask.extent.size.height;
    CIImage *mask = [rawMask imageByApplyingTransform:CGAffineTransformMakeScale(scaleX, scaleY)];
    mask = [[mask imageByApplyingFilter:@"CIMorphologyMinimum"
                    withInputParameters:@{kCIInputRadiusKey: @2.0}] imageByCroppingToRect:source.extent];
    CIImage *transparent = [[CIImage imageWithColor:[CIColor colorWithRed:0 green:0 blue:0 alpha:0]] imageByCroppingToRect:source.extent];
    CIFilter *blend = [CIFilter filterWithName:@"CIBlendWithMask"];
    [blend setValue:source forKey:kCIInputImageKey];
    [blend setValue:transparent forKey:kCIInputBackgroundImageKey];
    [blend setValue:mask forKey:kCIInputMaskImageKey];
    CIImage *cutout = blend.outputImage;

    CGColorSpaceRef colorSpace = CGColorSpaceCreateWithName(kCGColorSpaceSRGB);
    BOOL written = [context writePNGRepresentationOfImage:cutout
                                                    toURL:outputURL
                                                   format:kCIFormatRGBA8
                                               colorSpace:colorSpace
                                                  options:@{}
                                                    error:error];
    CGColorSpaceRelease(colorSpace);
    return written;
}

int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc < 3) {
            fprintf(stderr, "用法：cutout-motion-frames 输出目录 图片...\n");
            return 2;
        }

        NSFileManager *files = NSFileManager.defaultManager;
        NSURL *outputDirectory = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[1]] isDirectory:YES];
        NSError *error = nil;
        if (![files createDirectoryAtURL:outputDirectory withIntermediateDirectories:YES attributes:nil error:&error]) {
            fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
            return 1;
        }

        CIContext *context = [CIContext contextWithOptions:@{kCIContextCacheIntermediates: @NO}];
        for (int index = 2; index < argc; index++) {
            NSURL *sourceURL = [NSURL fileURLWithPath:[NSString stringWithUTF8String:argv[index]]];
            NSString *outputName = [[sourceURL.lastPathComponent stringByDeletingPathExtension] stringByAppendingPathExtension:@"png"];
            NSURL *outputURL = [outputDirectory URLByAppendingPathComponent:outputName];
            error = nil;
            if (!CutOutImage(sourceURL, outputURL, context, &error)) {
                fprintf(stderr, "%s\n", error.localizedDescription.UTF8String);
                return 1;
            }
            printf("%s\n", outputURL.path.UTF8String);
        }
    }
    return 0;
}
