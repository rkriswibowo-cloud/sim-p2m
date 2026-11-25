package auth

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"

	"golang.org/x/crypto/argon2"
)

const passwordPrefix = "$argon2id$v=19$m=65536,t=3,p=2$"

func passwordKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 3, 65536, 2, 32)
}

func HashPassword(password string) (string, error) {
	if len(password) < 12 || len(password) > 256 {
		return "", errors.New("password must be between 12 and 256 bytes")
	}
	salt := make([]byte, 16)
	if _, err := rand.Read(salt); err != nil {
		return "", err
	}
	encoding := base64.RawStdEncoding
	return passwordPrefix + encoding.EncodeToString(salt) + "$" + encoding.EncodeToString(passwordKey(password, salt)), nil
}

func matchesPassword(encoded, password string) bool {
	fields, ok := strings.CutPrefix(encoded, passwordPrefix)
	saltText, keyText, separated := strings.Cut(fields, "$")
	salt, saltErr := base64.RawStdEncoding.DecodeString(saltText)
	key, keyErr := base64.RawStdEncoding.DecodeString(keyText)
	if !ok || !separated || saltErr != nil || keyErr != nil || len(salt) != 16 || len(key) != 32 {
		// Keep the expensive verification for unknown accounts as well.
		passwordKey(password, make([]byte, 16))
		return false
	}
	return subtle.ConstantTimeCompare(key, passwordKey(password, salt)) == 1
}
