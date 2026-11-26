// macOS 本地 OCR（Vision framework）：识别中文/英文并输出带坐标的行，供在线简历结构化使用。
//
// 用法：vision-ocr <图片1> [图片2 ...]
// 输出：JSON 数组 [{ file, width, height, lines: [{ text, x, y, w, h, conf }] }]
// 坐标均为 0~1 归一化值，y 从页面顶部向下增长（已按阅读顺序排序）。

import AppKit
import CoreImage
import Foundation
import Vision

struct Line: Codable {
    let text: String
    let x: Double
    let y: Double
    let w: Double
    let h: Double
    let conf: Double
}

struct Page: Codable {
    let file: String
    let width: Int
    let height: Int
    let lines: [Line]
    let error: String?
}

func recognize(path: String) -> Page {
    guard let image = NSImage(contentsOfFile: path),
          let tiff = image.tiffRepresentation,
          let rep = NSBitmapImageRep(data: tiff),
          let cg = rep.cgImage
    else {
        return Page(file: path, width: 0, height: 0, lines: [], error: "无法读取图片")
    }

    var collected: [Line] = []

    // 两轮识别：原图 + 增强图（提对比度、去饱和），用于找回浅灰小字标题
    for variant in [cg, enhanced(cg) ?? cg] {
        let request = VNRecognizeTextRequest()
        request.recognitionLevel = .accurate
        request.recognitionLanguages = ["zh-Hans", "en-US"]
        request.usesLanguageCorrection = true
        // 简历正文多为小字，放宽最小文字高度
        request.minimumTextHeight = 0.003

        let handler = VNImageRequestHandler(cgImage: variant, options: [:])
        do {
            try handler.perform([request])
        } catch {
            continue
        }

        for obs in request.results ?? [] {
            guard let cand = obs.topCandidates(1).first else { continue }
            let b = obs.boundingBox
            let text = cand.string.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.isEmpty { continue }
            collected.append(
                Line(
                    text: text,
                    x: Double(b.origin.x),
                    y: Double(1 - b.origin.y - b.height),
                    w: Double(b.width),
                    h: Double(b.height),
                    conf: Double(cand.confidence)
                )
            )
        }
    }

    // 两轮结果去重：文本相同且位置接近视为同一条，保留置信度高的一份
    var lines: [Line] = []
    for cand in collected.sorted(by: { $0.conf > $1.conf }) {
        let dup = lines.contains { exist in
            exist.text == cand.text && abs(exist.y - cand.y) < 0.008 && abs(exist.x - cand.x) < 0.02
        }
        if !dup { lines.append(cand) }
    }

    // 按行聚类：同一视觉行内按 x 排序，行间按 y 排序
    lines.sort { a, b in
        if abs(a.y - b.y) < 0.006 { return a.x < b.x }
        return a.y < b.y
    }

    return Page(file: path, width: cg.width, height: cg.height, lines: lines, error: nil)
}

/// 提升对比度并去饱和，帮助识别浅灰色小字
func enhanced(_ image: CGImage) -> CGImage? {
    let ci = CIImage(cgImage: image)
    guard let filter = CIFilter(name: "CIColorControls") else { return nil }
    filter.setValue(ci, forKey: kCIInputImageKey)
    filter.setValue(2.1, forKey: kCIInputContrastKey)
    filter.setValue(0.02, forKey: kCIInputBrightnessKey)
    filter.setValue(0.0, forKey: kCIInputSaturationKey)
    guard let output = filter.outputImage else { return nil }
    let context = CIContext(options: nil)
    return context.createCGImage(output, from: ci.extent)
}

let args = Array(CommandLine.arguments.dropFirst())
if args.isEmpty {
    FileHandle.standardError.write("usage: vision-ocr <image> [image...]\n".data(using: .utf8)!)
    exit(1)
}

let pages = args.map { recognize(path: $0) }
let encoder = JSONEncoder()
encoder.outputFormatting = [.withoutEscapingSlashes]
guard let data = try? encoder.encode(pages), let out = String(data: data, encoding: .utf8) else {
    FileHandle.standardError.write("JSON 编码失败\n".data(using: .utf8)!)
    exit(2)
}
print(out)
