package database

import (
	"context"
	"database/sql"
	"errors"

	"gorm.io/driver/mysql"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
)

func Open(ctx context.Context, dsn string) (*sql.DB, error) {
	connection, err := gorm.Open(mysql.New(mysql.Config{
		DSN:                       dsn,
		SkipInitializeWithVersion: true,
	}), &gorm.Config{
		DisableAutomaticPing: true,
		Logger:               logger.Default.LogMode(logger.Silent),
	})
	if err != nil {
		return nil, errors.New("initialize MariaDB driver")
	}
	pool, err := connection.DB()
	if err != nil {
		return nil, errors.New("initialize MariaDB pool")
	}
	if err := pool.PingContext(ctx); err != nil {
		pool.Close()
		return nil, errors.New("connect to MariaDB")
	}
	return pool, nil
}
