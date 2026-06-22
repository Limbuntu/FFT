package report

import (
	"bytes"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/limbuntu/fft/internal/models"
)

const (
	pageWidth  = 595.28
	pageHeight = 841.89
	margin     = 40.0
)

type fileRow struct {
	Name         string
	InputPath    string
	OutputPath   string
	OriginalSize int64
	OutputSize   int64
	Change       float64
	DurationSec  float64
	SpeedMB      float64
}

type summary struct {
	Rows          []fileRow
	OriginalSize  int64
	OutputSize    int64
	SavedSize     int64
	AverageChange float64
	BestChange    float64
	DurationSec   float64
}

func GenerateTaskPDF(task models.TaskInfo) ([]byte, string, error) {
	if task.Status != models.TaskDone {
		return nil, "", fmt.Errorf("task is not finished")
	}
	s := buildSummary(task)
	doc := newPDF()
	drawReport(doc, task, s)
	filename := fmt.Sprintf("fft-task-%s-report.pdf", safeName(task.TaskID))
	return doc.Bytes(), filename, nil
}

func buildSummary(task models.TaskInfo) summary {
	rows := make([]fileRow, 0, len(task.Results))
	results := append([]models.TaskFileResult(nil), task.Results...)
	if len(results) == 0 && len(task.Request.Files) == 1 && task.OutputPath != "" {
		results = append(results, models.TaskFileResult{
			InputPath:    task.Request.Files[0],
			OutputPath:   task.OutputPath,
			OriginalSize: statSize(task.Request.Files[0]),
			OutputSize:   statSize(task.OutputPath),
			StartedAt:    task.CreatedAt,
			FinishedAt:   task.FinishedAt,
			DurationSec:  task.DurationSec,
		})
	}
	sort.SliceStable(results, func(i, j int) bool {
		return results[i].StartedAt.Before(results[j].StartedAt)
	})

	var originalTotal, outputTotal int64
	var changeTotal, bestChange float64
	for i, result := range results {
		original := firstNonZero(result.OriginalSize, statSize(result.InputPath))
		output := firstNonZero(result.OutputSize, statSize(result.OutputPath))
		duration := result.DurationSec
		if duration <= 0 && !result.StartedAt.IsZero() && !result.FinishedAt.IsZero() {
			duration = result.FinishedAt.Sub(result.StartedAt).Seconds()
		}
		change := 0.0
		if original > 0 {
			change = (float64(output-original) / float64(original)) * 100
		}
		speed := 0.0
		if duration > 0 {
			speed = float64(output) / 1024 / 1024 / duration
		}
		if i == 0 || change < bestChange {
			bestChange = change
		}
		changeTotal += change
		originalTotal += original
		outputTotal += output
		rows = append(rows, fileRow{
			Name:         filepath.Base(result.InputPath),
			InputPath:    result.InputPath,
			OutputPath:   result.OutputPath,
			OriginalSize: original,
			OutputSize:   output,
			Change:       change,
			DurationSec:  duration,
			SpeedMB:      speed,
		})
	}

	duration := task.DurationSec
	if duration <= 0 && !task.CreatedAt.IsZero() && !task.FinishedAt.IsZero() {
		duration = task.FinishedAt.Sub(task.CreatedAt).Seconds()
	}
	avgChange := 0.0
	if len(rows) > 0 {
		avgChange = changeTotal / float64(len(rows))
	}
	return summary{
		Rows:          rows,
		OriginalSize:  originalTotal,
		OutputSize:    outputTotal,
		SavedSize:     originalTotal - outputTotal,
		AverageChange: avgChange,
		BestChange:    bestChange,
		DurationSec:   duration,
	}
}

func drawReport(doc *pdfDocument, task models.TaskInfo, s summary) {
	p := doc.NewPage()
	drawHeader(p, task)
	p.Y = 152
	drawStats(p, task, s)
	p.Y += 118
	drawRecommendation(p, task, s)
	p.Y += 76
	drawParams(p, task)
	p.Y += 128
	drawResultsTable(doc, p, s.Rows)
	drawFooter(doc)
}

func drawHeader(p *pdfPage, task models.TaskInfo) {
	p.FillColor(102, 126, 234)
	p.Rect(margin, 32, pageWidth-margin*2, 86, true)
	p.TextColor(255, 255, 255)
	p.Text(62, 66, 24, "AV1 Transcode Report")
	p.Text(62, 92, 10.5, "Generated: "+time.Now().Format("2006-01-02 15:04:05"))
	p.Text(62, 108, 10.5, "Task ID: "+task.TaskID)
}

func drawStats(p *pdfPage, task models.TaskInfo, s summary) {
	labels := []string{"Files", "Average Change", "Best Saving", "Total Time"}
	values := []string{
		fmt.Sprintf("%d", maxInt(len(s.Rows), task.TotalFiles)),
		formatPercent(s.AverageChange),
		formatPercent(s.BestChange),
		formatSeconds(s.DurationSec),
	}
	x := margin
	w := (pageWidth - margin*2 - 30) / 4
	for i := range labels {
		p.FillColor(255, 255, 255)
		p.StrokeColor(229, 222, 212)
		p.Rect(x, p.Y, w, 78, true)
		p.Rect(x, p.Y, w, 78, false)
		p.TextColor(107, 114, 128)
		p.Text(x+12, p.Y+22, 9.5, labels[i])
		if strings.HasPrefix(values[i], "-") {
			p.TextColor(39, 174, 96)
		} else if i == 1 || i == 2 {
			p.TextColor(231, 76, 60)
		} else {
			p.TextColor(20, 23, 31)
		}
		p.Text(x+12, p.Y+52, 18, values[i])
		x += w + 10
	}
}

func drawRecommendation(p *pdfPage, task models.TaskInfo, s summary) {
	p.FillColor(209, 236, 241)
	p.Rect(margin, p.Y, pageWidth-margin*2, 58, true)
	p.FillColor(23, 162, 184)
	p.Rect(margin, p.Y, 4, 58, true)
	p.TextColor(12, 84, 96)
	p.Text(margin+16, p.Y+20, 13, "Recommendation")
	p.TextColor(44, 62, 80)
	message := recommendation(task, s)
	lines := wrapText(message, 94)
	for i, line := range lines {
		if i >= 2 {
			break
		}
		p.Text(margin+16, p.Y+39+float64(i)*13, 9.5, line)
	}
}

func drawParams(p *pdfPage, task models.TaskInfo) {
	p.TextColor(20, 23, 31)
	p.Text(margin, p.Y, 14, "Task Parameters")
	p.Y += 14
	rows := [][2]string{
		{"Encoder", task.Request.Encoder},
		{"CRF", fmt.Sprint(task.Request.CRF)},
		{"Preset", task.Request.Preset.String()},
		{"Output", valueOr(task.Request.OutputExt, "auto")},
		{"Suffix", valueOr(task.Request.Suffix, "-")},
		{"Extra Args", valueOr(strings.Join(task.Request.ExtraArgs, " "), "none")},
	}
	colW := (pageWidth - margin*2 - 12) / 2
	for i, row := range rows {
		col := i % 2
		line := i / 2
		x := margin + float64(col)*(colW+12)
		y := p.Y + float64(line)*32
		p.FillColor(255, 255, 255)
		p.StrokeColor(229, 222, 212)
		p.Rect(x, y, colW, 25, true)
		p.Rect(x, y, colW, 25, false)
		p.TextColor(107, 114, 128)
		p.Text(x+8, y+10, 8, row[0])
		p.TextColor(20, 23, 31)
		p.Text(x+68, y+10, 8.5, truncate(row[1], 34))
	}
}

func drawResultsTable(doc *pdfDocument, p *pdfPage, rows []fileRow) {
	if p.Y > 675 {
		p = doc.NewPage()
	}
	p.TextColor(20, 23, 31)
	p.Text(margin, p.Y, 14, "Detailed Results")
	p.Y += 18
	drawTableHeader(p)
	if len(rows) == 0 {
		p.Y += 30
		p.TextColor(107, 114, 128)
		p.Text(margin+12, p.Y, 9, "No file result data is available.")
		return
	}
	for _, row := range rows {
		if p.Y > 770 {
			p = doc.NewPage()
			p.Y = 56
			drawTableHeader(p)
		}
		drawTableRow(p, row)
	}
}

func drawTableHeader(p *pdfPage) {
	headers := []string{"File", "Original", "Output", "Change", "Time", "Speed"}
	widths := []float64{175, 72, 72, 64, 64, 64}
	x := margin
	p.FillColor(52, 73, 94)
	p.Rect(margin, p.Y, pageWidth-margin*2, 24, true)
	p.TextColor(255, 255, 255)
	for i, header := range headers {
		p.Text(x+6, p.Y+16, 8.5, header)
		x += widths[i]
	}
	p.Y += 24
}

func drawTableRow(p *pdfPage, row fileRow) {
	widths := []float64{175, 72, 72, 64, 64, 64}
	values := []string{
		truncate(row.Name, 28),
		formatBytes(row.OriginalSize),
		formatBytes(row.OutputSize),
		formatPercent(row.Change),
		formatSeconds(row.DurationSec),
		fmt.Sprintf("%.2f MB/s", row.SpeedMB),
	}
	p.FillColor(255, 255, 255)
	p.StrokeColor(236, 240, 241)
	p.Rect(margin, p.Y, pageWidth-margin*2, 28, true)
	p.Rect(margin, p.Y, pageWidth-margin*2, 28, false)
	x := margin
	for i, value := range values {
		if i == 3 && strings.HasPrefix(value, "-") {
			p.TextColor(39, 174, 96)
		} else if i == 3 {
			p.TextColor(231, 76, 60)
		} else {
			p.TextColor(44, 62, 80)
		}
		p.Text(x+6, p.Y+17, 8.2, value)
		x += widths[i]
	}
	p.Y += 28
}

func drawFooter(doc *pdfDocument) {
	for i, p := range doc.Pages {
		p.TextColor(127, 140, 141)
		p.Text(margin, 816, 8, "AV1 Transcode Report | FFmpeg task")
		p.Text(pageWidth-margin-60, 816, 8, fmt.Sprintf("Page %d / %d", i+1, len(doc.Pages)))
	}
}

func recommendation(task models.TaskInfo, s summary) string {
	if len(s.Rows) == 0 {
		return "The task finished, but no file size data was captured. Future tasks will include more complete compression results."
	}
	if s.OriginalSize <= 0 {
		return "The task finished. Because the original size is unavailable, this report only lists output files and parameters."
	}
	if s.SavedSize > 0 {
		return fmt.Sprintf("Using %s (CRF=%d, Preset=%s) saved %s overall, with a total size change of %s. These settings are suitable for similar media.",
			task.Request.Encoder, task.Request.CRF, task.Request.Preset.String(), formatBytes(s.SavedSize), formatPercent(totalChange(s)))
	}
	return fmt.Sprintf("The output is %s larger than the input, with a total size change of %s. Consider raising CRF, changing Preset, or checking whether the source was already highly compressed.",
		formatBytes(-s.SavedSize), formatPercent(totalChange(s)))
}

func totalChange(s summary) float64 {
	if s.OriginalSize == 0 {
		return 0
	}
	return (float64(s.OutputSize-s.OriginalSize) / float64(s.OriginalSize)) * 100
}

func statSize(path string) int64 {
	if path == "" {
		return 0
	}
	st, err := os.Stat(path)
	if err != nil {
		return 0
	}
	return st.Size()
}

func firstNonZero(values ...int64) int64 {
	for _, value := range values {
		if value > 0 {
			return value
		}
	}
	return 0
}

func valueOr(value, fallback string) string {
	if strings.TrimSpace(value) == "" {
		return fallback
	}
	return value
}

func safeName(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "report"
	}
	replacer := strings.NewReplacer("/", "_", "\\", "_", ":", "_", " ", "_")
	return replacer.Replace(value)
}

func maxInt(a, b int) int {
	if a > b {
		return a
	}
	return b
}

func formatBytes(bytes int64) string {
	if bytes <= 0 {
		return "0 B"
	}
	units := []string{"B", "KB", "MB", "GB", "TB"}
	value := float64(bytes)
	index := 0
	for value >= 1024 && index < len(units)-1 {
		value /= 1024
		index++
	}
	if index == 0 {
		return fmt.Sprintf("%d %s", bytes, units[index])
	}
	return fmt.Sprintf("%.1f %s", value, units[index])
}

func formatPercent(value float64) string {
	if math.Abs(value) < 0.05 {
		return "0.0%"
	}
	return fmt.Sprintf("%+.1f%%", value)
}

func formatSeconds(seconds float64) string {
	if seconds <= 0 {
		return "0s"
	}
	if seconds >= 3600 {
		hours := int(seconds / 3600)
		minutes := int(math.Mod(seconds, 3600) / 60)
		return fmt.Sprintf("%dh %dm", hours, minutes)
	}
	if seconds >= 60 {
		minutes := int(seconds / 60)
		secs := int(math.Mod(seconds, 60))
		return fmt.Sprintf("%dm %ds", minutes, secs)
	}
	return fmt.Sprintf("%.1fs", seconds)
}

func truncate(value string, maxRunes int) string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes-1]) + "..."
}

func wrapText(value string, maxRunes int) []string {
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return []string{value}
	}
	var lines []string
	for len(runes) > 0 {
		n := maxRunes
		if len(runes) < n {
			n = len(runes)
		}
		lines = append(lines, string(runes[:n]))
		runes = runes[n:]
	}
	return lines
}

type pdfDocument struct {
	Pages []*pdfPage
}

type pdfPage struct {
	buf strings.Builder
	Y   float64
}

func newPDF() *pdfDocument {
	return &pdfDocument{}
}

func (d *pdfDocument) NewPage() *pdfPage {
	p := &pdfPage{Y: margin}
	d.Pages = append(d.Pages, p)
	return p
}

func (d *pdfDocument) Bytes() []byte {
	if len(d.Pages) == 0 {
		d.NewPage()
	}
	var objects []string
	addObject := func(body string) int {
		objects = append(objects, body)
		return len(objects)
	}
	catalogID := addObject("<< /Type /Catalog /Pages 2 0 R >>")
	_ = catalogID
	pagesID := addObject("")
	fontID := addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>")

	pageIDs := make([]int, 0, len(d.Pages))
	for _, page := range d.Pages {
		content := page.buf.String()
		contentID := addObject(fmt.Sprintf("<< /Length %d >>\nstream\n%s\nendstream", len(content), content))
		pageID := addObject(fmt.Sprintf("<< /Type /Page /Parent %d 0 R /MediaBox [0 0 %.2f %.2f] /Resources << /Font << /F1 %d 0 R >> >> /Contents %d 0 R >>", pagesID, pageWidth, pageHeight, fontID, contentID))
		pageIDs = append(pageIDs, pageID)
	}

	kids := make([]string, 0, len(pageIDs))
	for _, id := range pageIDs {
		kids = append(kids, fmt.Sprintf("%d 0 R", id))
	}
	objects[pagesID-1] = fmt.Sprintf("<< /Type /Pages /Kids [%s] /Count %d >>", strings.Join(kids, " "), len(pageIDs))

	var out bytes.Buffer
	out.WriteString("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n")
	offsets := make([]int, len(objects)+1)
	for i, object := range objects {
		offsets[i+1] = out.Len()
		fmt.Fprintf(&out, "%d 0 obj\n%s\nendobj\n", i+1, object)
	}
	xref := out.Len()
	fmt.Fprintf(&out, "xref\n0 %d\n", len(objects)+1)
	out.WriteString("0000000000 65535 f \n")
	for i := 1; i <= len(objects); i++ {
		fmt.Fprintf(&out, "%010d 00000 n \n", offsets[i])
	}
	fmt.Fprintf(&out, "trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n", len(objects)+1, xref)
	return out.Bytes()
}

func (p *pdfPage) FillColor(r, g, b int) {
	fmt.Fprintf(&p.buf, "%.3f %.3f %.3f rg\n", float64(r)/255, float64(g)/255, float64(b)/255)
}

func (p *pdfPage) StrokeColor(r, g, b int) {
	fmt.Fprintf(&p.buf, "%.3f %.3f %.3f RG\n", float64(r)/255, float64(g)/255, float64(b)/255)
}

func (p *pdfPage) TextColor(r, g, b int) {
	p.FillColor(r, g, b)
}

func (p *pdfPage) Rect(x, y, w, h float64, fill bool) {
	op := "S"
	if fill {
		op = "f"
	}
	fmt.Fprintf(&p.buf, "%.2f %.2f %.2f %.2f re %s\n", x, pageHeight-y-h, w, h, op)
}

func (p *pdfPage) Text(x, y, size float64, text string) {
	fmt.Fprintf(&p.buf, "BT /F1 %.2f Tf %.2f %.2f Td <%s> Tj ET\n", size, x, pageHeight-y, pdfHex(text))
}

func pdfHex(value string) string {
	var b strings.Builder
	for _, r := range value {
		if r < 32 || r > 126 {
			r = '?'
		}
		fmt.Fprintf(&b, "%02X", byte(r))
	}
	return b.String()
}
