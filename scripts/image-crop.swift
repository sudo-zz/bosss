// 按像素矩形裁剪图片（macOS，CoreGraphics）。用于把 Safari 整窗截图裁成纯简历区域。
//
// 用法：image-crop <输入> <输出> <x> <y> <宽> <高>

import AppKit
import Foundation

let args = Array(CommandLine.arguments.dropFirst())
guard args.count >= 6 else {
    FileHandle.standardError.write("usage: image-crop <in> <out> <x> <y> <w> <h>\n".data(using: .utf8)!)
    exit(1)
}

let input = args[0]
let output = args[1]
guard let x = Int(args[2]), let y = Int(args[3]), let w = Int(args[4]), let h = Int(args[5]) else {
    FileHandle.standardError.write("invalid rect\n".data(using: .utf8)!)
    exit(2)
}

guard let image = NSImage(contentsOfFile: input),
      let tiff = image.tiffRepresentation,
      let rep = NSBitmapImageRep(data: tiff),
      let cg = rep.cgImage
else {
    FileHandle.standardError.write("cannot read image\n".data(using: .utf8)!)
    exit(3)
}

let bounds = CGRect(x: 0, y: 0, width: cg.width, height: cg.height)
let rect = CGRect(x: x, y: y, width: w, height: h).intersection(bounds)
if rect.width < 20 || rect.height < 20 {
    FileHandle.standardError.write("rect out of bounds\n".data(using: .utf8)!)
    exit(4)
}

guard let cropped = cg.cropping(to: rect) else {
    FileHandle.standardError.write("crop failed\n".data(using: .utf8)!)
    exit(5)
}

let bitmap = NSBitmapImageRep(cgImage: cropped)
guard let png = bitmap.representation(using: .png, properties: [:]) else {
    FileHandle.standardError.write("encode failed\n".data(using: .utf8)!)
    exit(6)
}
try png.write(to: URL(fileURLWithPath: output))
print("ok \(Int(rect.width))x\(Int(rect.height))")
