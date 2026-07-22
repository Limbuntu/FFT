package presets

import (
	"errors"
	"slices"
	"strconv"

	"github.com/limbuntu/fft/internal/models"
	fftdb "github.com/limbuntu/fft/internal/store"
)

var Builtins = []models.Preset{
	{Name: "极速", Encoder: "libsvtav1", CRF: 35, Preset: "12", ExtraArgs: []string{}, Builtin: true, OutputExt: "auto"},
	{Name: "Proxy", Encoder: "libsvtav1", CRF: 30, Preset: "9", ExtraArgs: []string{"-pix_fmt", "yuv420p"}, Builtin: true, OutputExt: "auto", KeepFilename: true},
	{Name: "均衡", Encoder: "libsvtav1", CRF: 28, Preset: "8", ExtraArgs: []string{}, Builtin: true, OutputExt: "auto"},
	{Name: "高质量", Encoder: "libsvtav1", CRF: 23, Preset: "4", ExtraArgs: []string{}, Builtin: true, OutputExt: "auto"},
	{Name: "视觉无损", Encoder: "libsvtav1", CRF: 22, Preset: "6", ExtraArgs: []string{"-pix_fmt", "yuv420p10le", "-svtav1-params", "tune=0:enable-overlays=1"}, Builtin: true, OutputExt: ".mkv"},
	{Name: "无损", Encoder: "libsvtav1", CRF: 0, Preset: "4", ExtraArgs: []string{"-svtav1-params", "lossless=1"}, Builtin: true, OutputExt: "auto"},
	{Name: "视觉无损 QSV", Encoder: "av1_qsv", CRF: 25, Preset: "4", ExtraArgs: []string{"-vf", "format=p010", "-extbrc", "1", "-look_ahead", "1", "-look_ahead_depth", "40", "-extra_hw_frames", "40", "-tile_cols", "0", "-tile_rows", "0"}, Builtin: true, OutputExt: ".mp4"},
}

type Service struct {
	db *fftdb.DB
}

func New(db *fftdb.DB) *Service {
	return &Service{db: db}
}

func (s *Service) All() ([]models.Preset, error) {
	custom, err := s.db.CustomPresets()
	if err != nil {
		return nil, err
	}

	customByName := map[string]models.Preset{}
	for index, p := range custom {
		p = normalizePreset(p)
		custom[index] = p
		customByName[p.Name] = p
	}

	result := make([]models.Preset, 0, len(Builtins)+len(custom))
	builtinNames := map[string]bool{}
	for _, builtin := range Builtins {
		builtinNames[builtin.Name] = true
		if override, ok := customByName[builtin.Name]; ok {
			override.OutputFolder = builtin.OutputFolder
			override.KeepFilename = builtin.KeepFilename
			override.Builtin = true
			result = append(result, override)
		} else {
			result = append(result, builtin)
		}
	}

	slices.SortFunc(custom, func(a, b models.Preset) int {
		if a.Name < b.Name {
			return -1
		}
		if a.Name > b.Name {
			return 1
		}
		return 0
	})
	for _, p := range custom {
		if !builtinNames[p.Name] {
			result = append(result, p)
		}
	}
	return result, nil
}

func (s *Service) Save(p models.Preset) (models.Preset, error) {
	if p.Name == "" {
		return models.Preset{}, errors.New("preset name is required")
	}
	if p.Encoder == "" {
		p.Encoder = "libsvtav1"
	}
	if p.Preset == "" {
		p.Preset = "8"
	}
	if p.OutputExt == "" {
		p.OutputExt = "auto"
	}
	p = normalizePreset(p)
	builtinPreset := false
	for _, builtin := range Builtins {
		if builtin.Name == p.Name {
			p.OutputFolder = builtin.OutputFolder
			p.KeepFilename = builtin.KeepFilename
			builtinPreset = true
			break
		}
	}
	saved, err := s.db.SavePreset(p)
	if err != nil {
		return models.Preset{}, err
	}
	saved.Builtin = builtinPreset
	return saved, nil
}

func (s *Service) Delete(name string) (bool, error) {
	return s.db.DeletePreset(name)
}

func (s *Service) Reset(name string) (bool, error) {
	return s.db.DeletePreset(name)
}

func normalizePreset(p models.Preset) models.Preset {
	if p.Encoder != "libsvtav1" {
		return p
	}
	args := make([]string, 0, len(p.ExtraArgs))
	for i := 0; i < len(p.ExtraArgs); i++ {
		arg := p.ExtraArgs[i]
		switch arg {
		case "-crf":
			if i+1 < len(p.ExtraArgs) {
				if value, err := strconv.Atoi(p.ExtraArgs[i+1]); err == nil {
					p.CRF = value
				}
				i++
				continue
			}
		case "-preset":
			if i+1 < len(p.ExtraArgs) {
				p.Preset = models.PresetValue(p.ExtraArgs[i+1])
				i++
				continue
			}
		case "-c:a":
			if i+1 < len(p.ExtraArgs) && p.ExtraArgs[i+1] == "copy" {
				i++
				continue
			}
		}
		args = append(args, arg)
	}
	p.ExtraArgs = args
	return p
}
