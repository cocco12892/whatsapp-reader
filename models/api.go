package models

// CodiceGiocataRequest represents a request for a game code
type CodiceGiocataRequest struct {
	Evento         string  `json:"evento,omitempty"`
	Esito          string  `json:"esito"`
	TipsterID      int     `json:"tipster_id"`
	Percentuale    float64 `json:"percentuale"`
	ImmagineURL    string  `json:"immagine_url,omitempty"`
	ImmagineBase64 string  `json:"immagine_base64,omitempty"`
	APIKey         string  `json:"api_key"`
	ChatID         string  `json:"chat_id,omitempty"` // Added to support sending reactions
}

// CodiceGiocataResponse represents a response for a game code request
type CodiceGiocataResponse struct {
	Success bool   `json:"success"`
	Codice  string `json:"codice,omitempty"`
	Errore  string `json:"errore,omitempty"`
}

// GiocataAIRequest represents an AI game request
type GiocataAIRequest struct {
	Evento            string `json:"evento,omitempty"`
	SaleRivenditoreID int    `json:"sale_rivenditore_id"`
	ImmagineURL       string `json:"immagine_url,omitempty"`
	ImmagineBase64    string `json:"immagine_base64,omitempty"`
	APIKey            string `json:"api_key"`
}

// GiocataAIResponse represents an AI game response
type GiocataAIResponse struct {
	Success bool   `json:"success"`
	Message string `json:"message,omitempty"`
	Data    struct {
		ID              int     `json:"id"`
		CodiceGiocata   string  `json:"codice_giocata"`
		Rivenditore     string  `json:"rivenditore"`
		Quota           float64 `json:"quota"`
		Stake           float64 `json:"stake"`
		SheetsSaved     bool    `json:"sheets_saved"`
		Analyzed        bool    `json:"analyzed"`
		MatchConfidence string  `json:"match_confidence"`
		MatchReason     string  `json:"match_reason"`
		Evento          string  `json:"evento"`
		ImageSource     string  `json:"image_source"`
	} `json:"data,omitempty"`
	Error string `json:"error,omitempty"`
} 