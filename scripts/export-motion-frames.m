#import <AVFoundation/AVFoundation.h>
#import <AppKit/AppKit.h>

static int writeFrame(AVAssetImageGenerator *generator, double seconds, NSString *path) {
  CMTime time = CMTimeMakeWithSeconds(seconds, 600);
  NSError *error = nil;
  CGImageRef image = [generator copyCGImageAtTime:time actualTime:nil error:&error];
  if (!image) {
    fprintf(stderr, "frame %.3f failed: %s\n", seconds, error.localizedDescription.UTF8String);
    return 1;
  }

  NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithCGImage:image];
  NSData *data = [bitmap representationUsingType:NSBitmapImageFileTypeJPEG
                                      properties:@{NSImageCompressionFactor: @0.82}];
  CGImageRelease(image);
  return [data writeToFile:path atomically:YES] ? 0 : 1;
}

int main(int argc, const char *argv[]) {
  @autoreleasepool {
    if (argc != 3) {
      fprintf(stderr, "usage: export-motion-frames input.mp4 output-directory\n");
      return 2;
    }

    NSString *input = [NSString stringWithUTF8String:argv[1]];
    NSString *output = [NSString stringWithUTF8String:argv[2]];
    [[NSFileManager defaultManager] createDirectoryAtPath:output
                              withIntermediateDirectories:YES
                                               attributes:nil
                                                    error:nil];

    AVURLAsset *asset = [AVURLAsset URLAssetWithURL:[NSURL fileURLWithPath:input] options:nil];
    AVAssetImageGenerator *generator = [[AVAssetImageGenerator alloc] initWithAsset:asset];
    generator.appliesPreferredTrackTransform = YES;
    generator.maximumSize = NSMakeSize(640, 1120);
    generator.requestedTimeToleranceBefore = kCMTimeZero;
    generator.requestedTimeToleranceAfter = kCMTimeZero;

    const double duration = 2.8;
    const double fps = 18.0;
    const int frameCount = (int)ceil(duration * fps) + 1;
    for (int index = 0; index < frameCount; index++) {
      double seconds = MIN(index / fps, duration);
      NSString *name = [NSString stringWithFormat:@"frame-%03d.jpg", index];
      if (writeFrame(generator, seconds, [output stringByAppendingPathComponent:name])) return 3;
    }
    printf("exported %d frames to %s\n", frameCount, output.UTF8String);
  }
  return 0;
}
