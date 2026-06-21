package presets

import (
	"errors"
	"slices"

	"github.com/limbuntu/fft/internal/models"
	fftdb "github.com/limbuntu/fft/internal/store"
)

var Builtins = []models.Preset{
	{Name: "极速", Encoder: "libsvtav1", CRF: 35, Preset: "12", ExtraArgs: []string{}, Builtin: true, OutputExt: "auto"},
	{Name: "均衡", Encoder: "libsvtav1", CRF: 28, Preset: "8", ExtraArgs: []string{}, Builtin: true, OutputExt: "auto"},
	{Name: "高质量", Encoder: "libsvtav1", CRF: 23, Preset: "4", ExtraArgs: []string{}, Builtin: true, OutputExt: "auto"},
	{Name: "无损", Encoder: "libsvtav1", CRF: 0, Preset: "4", ExtraArgs: []string{"-svtav1-params", "lossless=1"}, Builtin: true, OutputExt: "auto"},
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
	for _, p := range custom {
		customByName[p.Name] = p
	}

	result := make([]models.Preset, 0, len(Builtins)+len(custom))
	builtinNames := map[string]bool{}
	for _, builtin := range Builtins {
		builtinNames[builtin.Name] = true
		if override, ok := customByName[builtin.Name]; ok {
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
	return s.db.SavePreset(p)
}

func (s *Service) Delete(name string) (bool, error) {
	return s.db.DeletePreset(name)
}

func (s *Service) Reset(name string) (bool, error) {
	return s.db.DeletePreset(name)
}
