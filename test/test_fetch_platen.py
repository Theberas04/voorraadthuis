import importlib.util
import pathlib
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('fetch_platen', ROOT / 'scripts' / 'fetch-platen.py')
fetch_platen = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fetch_platen)


class PlatenBarcodeTests(unittest.TestCase):
    def test_known_bad_barcode_is_corrected_in_generated_dataset(self):
        corrected = fetch_platen.pas_correcties_toe({})
        self.assertEqual(corrected['8717662593284']['t'], 'BBC Sessions 1970')
        self.assertEqual(corrected['8717662593284']['a'], 'Elton John')
        self.assertEqual(corrected['8717662593284']['j'], '2024')
        self.assertEqual(corrected['8717662593284']['l'], 'The Vinyl Champ')
        self.assertEqual(corrected['8717662593284']['g'], 'handmatige-correctie')

    def test_missing_doe_maar_barcode_is_added_to_generated_dataset(self):
        products = fetch_platen.pas_correcties_toe({})
        row = products['0602445070718']
        self.assertEqual(row['t'], 'Skunk')
        self.assertEqual(row['a'], 'Doe Maar')
        self.assertEqual(row['j'], '2022')
        self.assertEqual(row['l'], 'Music On Vinyl')
        self.assertEqual(row['f'], '12" Vinyl · 10 nummers')
        self.assertEqual(row['g'], 'handmatige-aanvulling')

    def test_only_scanner_supported_lengths_are_kept(self):
        for code in ('12345678', '12345678901', '123456789012', '1234567890123', '12345678901234'):
            with self.subTest(code=code):
                barcode, row = fetch_platen.rij_van({'barcode': code, 'title': 'LP', 'id': 'release-id'})
                self.assertEqual(barcode, code)
                self.assertIsNotNone(row)
        for code in ('1234567', '123456789012345', '123456789012345678'):
            with self.subTest(code=code):
                barcode, row = fetch_platen.rij_van({'barcode': code, 'title': 'LP', 'id': 'release-id'})
                self.assertIsNone(barcode)
                self.assertIsNone(row)


if __name__ == '__main__':
    unittest.main()
